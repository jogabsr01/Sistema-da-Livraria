#!/usr/bin/env node
// Read-only. Uses exported environment variables; never loads .env files implicitly.
import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { loadFirestoreSettings } from '../backend/firestore-config.mjs';
import { ownerEmailIndex, validateBootstrapIdentity } from './firestore-bootstrap-owner.mjs';

const OWNER_ID = '2d3c6d3c-4024-498e-97d2-ab9da231bd3d';
const EMAIL = 'jogabsr@gmail.com';

export async function inspectOwnerRecord({ db, identity }) {
  validateBootstrapIdentity(identity);
  const expectedIndex = ownerEmailIndex(identity, EMAIL);
  const users = db.collection('users');
  const [snapshot, indexed, byEmail, flows] = await Promise.all([
    users.doc(OWNER_ID).get(), users.where('emailIndex', '==', expectedIndex).get(),
    users.where('email', '==', EMAIL).get(), db.collection('authFlows').where('subjectId', '==', OWNER_ID).get(),
  ]);
  const user = snapshot.exists ? snapshot.data() : null;
  return {
    environment: identity.environment, installationId: identity.installationId,
    expectedEmailIndex: expectedIndex, ownerFound: snapshot.exists,
    owner: user ? { id: user.id ?? null, status: user.status ?? null, role: user.role ?? null, owner: user.owner ?? null,
      authorizationVersion: user.authorizationVersion ?? null, activated: user.activated ?? null,
      firstAccessCompleted: user.firstAccessCompleted ?? null, emailMatches: user.email === EMAIL,
      emailIndex: user.emailIndex ?? null, emailIndexMatches: user.emailIndex === expectedIndex } : null,
    indexMatches: indexed.docs.map(doc => doc.id), emailMatches: byEmail.docs.map(doc => doc.id),
    flows: flows.docs.map(doc => { const flow = doc.data(); return { purpose: flow.purpose ?? null, state: flow.state ?? null }; }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--allow-remote') || args.length > 1) throw new Error('USO: node scripts/inspect-owner-record.mjs [--allow-remote]');
  if (!process.env.FIRESTORE_EMULATOR_HOST && !args.includes('--allow-remote')) throw new Error('REDE_DESATIVADA: configure FIRESTORE_EMULATOR_HOST ou use --allow-remote explicitamente');
  const identity = { environment: process.env.APP_ENV, installationId: process.env.WORKSPACE_INSTALLATION_ID, secret: process.env.WORKSPACE_HMAC_SECRET };
  validateBootstrapIdentity(identity);
  const db = createFirestoreDb(loadFirestoreSettings());
  try { console.log(JSON.stringify(await inspectOwnerRecord({ db, identity }), null, 2)); }
  finally { await db.terminate(); }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`INSPEÇÃO FALHOU: ${error.message}`); process.exitCode = 1; });
}