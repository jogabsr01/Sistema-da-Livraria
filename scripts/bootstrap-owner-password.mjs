#!/usr/bin/env node
// Emergency local operator tool. Dry-run by default; never accepts passwords in arguments or environment.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPasswordHasher } from '../backend/credential-core.mjs';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { loadFirestoreSettings } from '../backend/firestore-config.mjs';

const OWNER_ID = '2d3c6d3c-4024-498e-97d2-ab9da231bd3d';
const EMAIL = 'jogabsr@gmail.com';

export function parseArguments(args) {
  const allowed = new Set(['--help', '--apply', '--allow-remote']);
  if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length || args.includes('--help') && args.length !== 1) throw Error('INVALID_ARGUMENTS');
  return { help: args.includes('--help'), apply: args.includes('--apply'), allowRemote: args.includes('--allow-remote') };
}

export async function readPassword(stream) {
  if (stream.isTTY) throw Error('PASSWORD_STDIN_REQUIRED');
  let input = '';
  for await (const chunk of stream) { input += chunk; if (Buffer.byteLength(input, 'utf8') > 1024) throw Error('PASSWORD_INPUT_TOO_LONG'); }
  return input.replace(/\r?\n$/, '');
}

export async function bootstrapOwnerPassword({ db, record, apply = false }) {
  const ownerRef = db.collection('users').doc(OWNER_ID);
  const credentialRef = ownerRef.collection('credentials').doc('primary');
  const auditId = randomUUID();
  return db.runTransaction(async tx => {
    const [snapshot, credential, owners, emails] = await Promise.all([
      tx.get(ownerRef), tx.get(credentialRef), tx.get(db.collection('users').where('role', '==', 'SUPER_ADMIN')),
      tx.get(db.collection('users').where('email', '==', EMAIL)),
    ]);
    const owner = snapshot.exists ? snapshot.data() : null;
    if (!owner || owner.id !== OWNER_ID || owner.email !== EMAIL || owner.role !== 'SUPER_ADMIN' || owner.owner !== true ||
        owner.status !== 'ATIVO' || owner.activated !== false || owner.firstAccessCompleted !== false ||
        !Number.isSafeInteger(owner.authorizationVersion) || owner.authorizationVersion < 1 || owner.authorizationVersion >= Number.MAX_SAFE_INTEGER || credential.exists ||
        owners.docs.length !== 1 || owners.docs[0].id !== OWNER_ID || emails.docs.length !== 1 || emails.docs[0].id !== OWNER_ID) throw Error('OWNER_NOT_ELIGIBLE');
    if (apply) {
      if (!record || record.credentialType !== 'PASSWORD_V1') throw Error('INVALID_CREDENTIAL');
      const now = new Date();
      tx.create(credentialRef, { ...record, updatedAt: now });
      // Invalidate previously issued activation flows and their ceremonies atomically.
      tx.update(ownerRef, { activated: true, firstAccessCompleted: true, authorizationVersion: owner.authorizationVersion + 1, updatedAt: now });
      tx.create(db.collection('auditEvents').doc(`identity-bootstrap:${auditId}`), { id: `identity-bootstrap:${auditId}`, at: now,
        actorId: OWNER_ID, role: 'SUPER_ADMIN', operation: 'IDENTITY_ADMIN_BOOTSTRAP', entity: 'users', entityId: OWNER_ID,
        result: 'SUCESSO', requestId: auditId, before: null, after: { authorizationVersion: owner.authorizationVersion + 1 }, detailsOmitted: true });
    }
    return { eligible: true, applied: apply };
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log('Uso: node scripts/bootstrap-owner-password.mjs [--allow-remote] [--apply]\nSomente leitura por padrão. --allow-remote autoriza acesso ao Firestore remoto; --apply exige senha pela entrada padrão, não pelo terminal interativo.');
    return;
  }
  if (!args.allowRemote) throw Error('REMOTE_ACCESS_NOT_ALLOWED');
  if (process.env.APP_ENV !== 'prod' || process.env.WORKSPACE_STORAGE_MODE !== 'firestore' || process.env.WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED !== 'true' ||
      process.env.FIRESTORE_EMULATOR_HOST || !/^[a-f0-9]{64}$/i.test(process.env.WORKSPACE_PIN_PEPPER || '')) throw Error('CONFIGURATION_INVALID');
  let record;
  if (args.apply) {
    const password = await readPassword(process.stdin);
    record = await createPasswordHasher({ environment: 'prod', installationId: process.env.WORKSPACE_INSTALLATION_ID, pepper: Buffer.from(process.env.WORKSPACE_PIN_PEPPER, 'hex') }).hash(password, OWNER_ID);
  }
  const db = createFirestoreDb(loadFirestoreSettings());
  try { console.log(JSON.stringify({ event: 'owner_password_bootstrap', ...await bootstrapOwnerPassword({ db, record, apply: args.apply }) })); }
  finally { await db.terminate(); }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`BOOTSTRAP FALHOU: ${/^[A-Z_]+$/.test(error?.message || '') ? error.message : 'OPERATION_FAILED'}`); process.exitCode = 1; });
}