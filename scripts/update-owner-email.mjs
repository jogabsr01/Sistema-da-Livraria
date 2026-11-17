#!/usr/bin/env node
// One-off operator tool: dry-run by default, never creates or changes credentials.
import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { loadFirestoreSettings } from '../backend/firestore-config.mjs';
import { ownerEmailIndex, validateBootstrapIdentity } from './firestore-bootstrap-owner.mjs';

const OWNER_ID = '2d3c6d3c-4024-498e-97d2-ab9da231bd3d';
const TARGET_EMAIL = 'jogabsr@gmail.com';

export async function updatePendingOwnerEmail({ db, identity, apply = false }) {
  validateBootstrapIdentity(identity);
  const index = ownerEmailIndex(identity, TARGET_EMAIL);
  return db.runTransaction(async tx => {
    const users = db.collection('users');
    const reference = users.doc(OWNER_ID);
    const [snapshot, owners, emails, indexes, credential, change] = await Promise.all([
      tx.get(reference), tx.get(users.where('role', '==', 'SUPER_ADMIN')),
      tx.get(users.where('email', '==', TARGET_EMAIL)), tx.get(users.where('emailIndex', '==', index)),
      tx.get(reference.collection('credentials').doc('primary')),
      tx.get(db.collection('authFlows').doc(`email-change:${OWNER_ID}`)),
    ]);
    if (!snapshot.exists) throw new Error('OWNER_NOT_FOUND');
    const owner = snapshot.data();
    if (!owner || owner.id && owner.id !== OWNER_ID || owner.owner !== true || owner.role !== 'SUPER_ADMIN' || owner.status !== 'ATIVO' ||
        !Number.isSafeInteger(owner.authorizationVersion) || owner.authorizationVersion < 1) throw new Error('OWNER_CONFLICT');
    if (owners.docs.length !== 1 || owners.docs[0].id !== OWNER_ID ||
        [...emails.docs, ...indexes.docs].some(doc => doc.id !== OWNER_ID)) throw new Error('DUPLICATE_IDENTITY');
    if (owner.activated !== false || owner.firstAccessCompleted !== false || credential.exists) throw new Error('OWNER_NOT_PENDING');
    if (change.exists) throw new Error('EMAIL_CHANGE_EXISTS');
    if (owner.contact || owner.cpfIndex) throw new Error('OWNER_PROFILE_REQUIRES_MANUAL_REVIEW');
    const changed = owner.email !== TARGET_EMAIL || owner.emailIndex !== index;
    if (changed && apply) tx.update(reference, { email: TARGET_EMAIL, emailIndex: index });
    return { changed, applied: changed && apply };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('USO: node scripts/update-owner-email.mjs [--apply]');
  if (process.env.APP_ENV !== 'prod' || process.env.WORKSPACE_STORAGE_MODE !== 'firestore' || !process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON || process.env.WORKSPACE_FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('CONFIGURAÇÃO_LOCAL_INVÁLIDA');
  const identity = { environment: process.env.APP_ENV, installationId: process.env.WORKSPACE_INSTALLATION_ID, secret: process.env.WORKSPACE_HMAC_SECRET };
  validateBootstrapIdentity(identity);
  const db = createFirestoreDb(loadFirestoreSettings());
  try {
    const result = await updatePendingOwnerEmail({ db, identity, apply: args.includes('--apply') });
    console.log(JSON.stringify({ event: 'owner_email_review', ...result, passwordCreated: false }));
  } finally { await db.terminate(); }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`FALHA: ${/^[A-Z_]+$/.test(error?.message || '') ? error.message : 'OPERAÇÃO_NÃO_CONCLUÍDA'}`); process.exitCode = 1; });
}