import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveExistingCustomer, resolveExistingMedia } from './firestore-document-mapper.mjs';

const domains = ['niches', 'products', 'customers', 'stockMovements', 'sales'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Internal protocol. The caller is responsible for validating the complete bundle
// and enforcing the target guard before providing a database connection.
export async function commitImportBundle(db, bundle, { runId, vaultSettings }) {
  if (!/^[a-f0-9]{64}$/.test(runId) || bundle?.writePerformed !== false) throw Error('IMPORT_PROTOCOL_INVALID');
  let committed = 0;
  try {
    for (const domain of domains) {
      const groups = bundle.domains[domain];
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        // One group and one checkpoint are atomic; never split sale items.
        if (!Array.isArray(group.documents) || group.documents.length > 99) throw Error('IMPORT_PROTOCOL_INVALID');
        const logical = group.documents.map(doc => ({ path: doc.path, data: domain === 'customers' && doc.path.startsWith('customers/')
          ? { ...doc.data, contact: group.fingerprint } : doc.data }));
        const digest = hash([domain, index, logical]);
        const checkpoint = db.doc(`migrationRuns/${runId}/checkpoints/${domain}`);
        const done = await db.runTransaction(async tx => {
          const checkpointSnap = await tx.get(checkpoint);
          const state = checkpointSnap.exists ? checkpointSnap.data() : null;
          if (state && (state.runId !== runId || !Array.isArray(state.hashes) || state.hashes.length > groups.length)) throw Error('IMPORT_CHECKPOINT_CONFLICT');
          if (state?.hashes[index] !== undefined) {
            if (state.hashes[index] !== digest) throw Error('IMPORT_CHECKPOINT_CONFLICT');
            return false;
          }
          if ((state?.hashes.length ?? 0) !== index) throw Error('IMPORT_CHECKPOINT_CONFLICT');
          const parentPath = domain === 'products' || domain === 'niches' ? `${domain}/${group.id}` : null;
          const mediaPath = parentPath ? `${parentPath}/media/${domain === 'products' ? 'cover' : 'image'}` : null;
          const refs = new Map(group.documents.map(doc => [doc.path, db.doc(doc.path)]));
          if (mediaPath && !refs.has(mediaPath)) refs.set(mediaPath, db.doc(mediaPath));
          const existing = new Map();
          for (const [path, ref] of refs) {
            const snap = await tx.get(ref);
            existing.set(path, snap.exists ? snap.data() : null);
          }
          let documents = group.documents;
          if (domain === 'customers') documents = resolveExistingCustomer({ mapped: { documents, fingerprint: group.fingerprint },
            existing: existing.get(`customers/${group.id}`), vaultSettings }).documents;
          if (parentPath) documents = resolveExistingMedia({ documents, parentPath, flag: domain === 'products' ? 'hasPhoto' : 'hasImage',
            existingParent: existing.get(parentPath), existingMedia: existing.get(mediaPath) });
          for (const doc of documents) {
            const old = existing.get(doc.path);
            if (old !== null && !isDeepStrictEqual(old, doc.data)) throw Error('IMPORT_DESTINATION_CONFLICT');
          }
          for (const doc of documents) if (existing.get(doc.path) === null) tx.create(refs.get(doc.path), doc.data);
          tx.set(checkpoint, { runId, hashes: [...(state?.hashes ?? []), digest] });
          return true;
        });
        if (done) committed++;
      }
    }
    return { status: 'COMPLETED', writePerformed: committed > 0, committedBatches: committed };
  } catch {
    // A transport error may occur after the server committed the transaction.
    return { status: 'FAILED', writePerformed: committed > 0 ? true : null, committedBatches: committed, code: 'IMPORT_COMMIT_FAILED' };
  }
}