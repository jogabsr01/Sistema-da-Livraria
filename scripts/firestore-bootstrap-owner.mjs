#!/usr/bin/env node
// One-time, local-only administrative tool. There is no public HTTP route
// for this, the same way the GAS `prepareDevelopmentOwnerAccess` function is
// never dispatched by doPost. It creates the single SUPER_ADMIN placeholder
// directly in Firestore so the existing activation flow
// (POST /api/v1/access/start) has a user document to find by e-mail index.
//
// Safe to run more than once: existing identity and activation state are
// preserved, and a second SUPER_ADMIN under a different e-mail is refused.
//
// Usage:
//   node scripts/firestore-bootstrap-owner.mjs --email=dono@exemplo.com
//
// Required environment variables, exported privately before running and
// never committed: APP_ENV, WORKSPACE_INSTALLATION_ID, WORKSPACE_HMAC_SECRET,
// WORKSPACE_STORAGE_MODE=firestore (or shadow), WORKSPACE_FIRESTORE_PROJECT_ID,
// WORKSPACE_FIRESTORE_DATABASE, WORKSPACE_FIRESTORE_LOCATION, and either
// WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON (real project) or
// FIRESTORE_EMULATOR_HOST (local emulator, for a dry run).
import { createHmac, createPrivateKey, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { loadFirestoreSettings, parseServiceAccountJson, readServiceAccountSource } from '../backend/firestore-config.mjs';

const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SECRET = /^[a-f0-9]{64}$/i;

export function ownerEmailIndex({ environment, installationId, secret }, email) {
  if (!['dev', 'prod'].includes(environment) || !INSTALLATION_ID.test(installationId || '') || !SECRET.test(secret || '')) {
    throw new Error('configuração inválida para calcular o índice de e-mail');
  }
  // Same domain-separated HMAC as ownerEmailIndex() in backend/firestore-access.mjs.
  // A mismatch here means findUser() will never locate this account.
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify(['identity.email.v1', environment, installationId, email]))
    .digest('hex');
}

export function validateBootstrapIdentity({ environment, installationId, secret }) {
  const invalid = [];
  if (!['dev', 'prod'].includes(environment)) invalid.push('APP_ENV (use dev ou prod)');
  if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId)) invalid.push('WORKSPACE_INSTALLATION_ID (UUID v4)');
  if (typeof secret !== 'string' || !SECRET.test(secret)) invalid.push('WORKSPACE_HMAC_SECRET (64 caracteres hexadecimais)');
  if (invalid.length) throw new Error(`configuração inválida para calcular o índice de e-mail: ${invalid.join(', ')}`);
}

export async function bootstrapOwner({ db, email, environment, installationId, secret }) {
  if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email)) throw new Error('e-mail inválido');
  validateBootstrapIdentity({ environment, installationId, secret });
  const normalizedEmail = email.toLowerCase();
  const index = ownerEmailIndex({ environment, installationId, secret }, normalizedEmail);

  return db.runTransaction(async transaction => {
    const byEmail = await transaction.get(db.collection('users').where('emailIndex', '==', index));
    const allSuperAdmins = await transaction.get(db.collection('users').where('role', '==', 'SUPER_ADMIN'));
    if (byEmail.docs.length > 1) throw new Error('mais de uma conta corresponde a este e-mail; investigue antes de continuar');
    if (allSuperAdmins.docs.length > 1) throw new Error('mais de um SUPER_ADMIN já existe; investigue antes de continuar');

    const existing = byEmail.docs[0];
    if (existing) {
      const value = existing.data();
      if (value.role !== 'SUPER_ADMIN' || value.owner !== true || value.status !== 'ATIVO' ||
          (value.email !== undefined && value.email !== normalizedEmail)) {
        throw new Error('a conta existente não corresponde ao proprietário esperado; investigue antes de continuar');
      }
      const missing = {};
      if (value.email === undefined) missing.email = normalizedEmail;
      if (value.revision === undefined) missing.revision = 0;
      if (value.contact === undefined) missing.contact = '';
      if (value.hasPhoto === undefined) missing.hasPhoto = false;
      if (Object.keys(missing).length) transaction.update(db.collection('users').doc(existing.id), missing);
      return { id: existing.id, created: false };
    }

    const otherOwner = allSuperAdmins.docs[0];
    if (otherOwner) throw new Error(`já existe um SUPER_ADMIN (id ${otherOwner.id}) vinculado a outro e-mail; este sistema permite apenas um`);

    const id = randomUUID();
    const now = new Date();
    transaction.create(db.collection('users').doc(id), {
      id,
      owner: true,
      role: 'SUPER_ADMIN',
      status: 'ATIVO',
      authorizationVersion: 1,
      activated: false,
      firstAccessCompleted: false,
      emailIndex: index,
      email: normalizedEmail,
      revision: 0,
      contact: '',
      hasPhoto: false,
      createdAt: now,
      createdBy: id,
    });
    return { id, created: true };
  });
}

function parseEmailArgument(argv) {
  const flag = argv.find(arg => arg.startsWith('--email='));
  return flag ? flag.slice('--email='.length) : argv[0];
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value) throw new Error(`variável de ambiente ausente: ${name}`);
  return value;
}

export function logBootstrapPreflight(env = process.env, log = console.log) {
  for (const name of ['APP_ENV', 'WORKSPACE_STORAGE_MODE', 'WORKSPACE_INSTALLATION_ID', 'WORKSPACE_HMAC_SECRET',
    'WORKSPACE_FIRESTORE_PROJECT_ID', 'WORKSPACE_FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT',
    'WORKSPACE_FIRESTORE_DATABASE', 'WORKSPACE_FIRESTORE_LOCATION', 'WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS', 'FIRESTORE_EMULATOR_HOST', 'WORKSPACE_EMAIL_DELIVERY_KEY']) {
    log(`[DEBUG] ${name} presente: ${typeof env[name] === 'string' && env[name].length > 0}`);
  }
  log(`[DEBUG] STORAGE_MODE_FORMAT_VALID: ${['gas', 'shadow', 'firestore'].includes(env.WORKSPACE_STORAGE_MODE ?? 'gas')}`);
  let account, reason;
  try {
    const source = readServiceAccountSource(env);
    if (source) account = parseServiceAccountJson(source);
  } catch (error) { reason = error.message === 'CREDENTIAL_FILE_UNAVAILABLE' ? 'CREDENTIAL_FILE_UNAVAILABLE' : 'MALFORMED_JSON'; }
  const hasProject = typeof account?.project_id === 'string' && account.project_id.length > 0;
  const hasKey = typeof account?.private_key === 'string' && account.private_key.length > 0;
  const projectIds = ['WORKSPACE_FIRESTORE_PROJECT_ID', 'WORKSPACE_FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']
    .map(name => env[name]).filter(value => typeof value === 'string' && value.length > 0);
  const matches = hasProject && projectIds.length > 0 && projectIds.every(value => value === account.project_id);
  log(`[DEBUG] SERVICE_ACCOUNT_IS_VALID_JSON: ${!!account}`);
  log(`[DEBUG] SERVICE_ACCOUNT_HAS_PROJECT_ID: ${hasProject}`);
  log(`[DEBUG] SERVICE_ACCOUNT_HAS_PRIVATE_KEY: ${hasKey}`);
  log(`[DEBUG] SERVICE_ACCOUNT_PROJECT_MATCHES_ENV: ${matches}`);
  if (!account) log(`[DEBUG] SERVICE_ACCOUNT_STATUS: ${reason || 'NOT_PROVIDED'}`);
  if (account && env.APP_ENV === 'prod') {
    const emailValid = typeof account.client_email === 'string' && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email);
    let keyValid = false;
    try { keyValid = createPrivateKey(account.private_key.replace(/\\n/g, '\n')).asymmetricKeyType === 'rsa'; } catch {}
    log(`[DEBUG] SERVICE_ACCOUNT_EMAIL_VALID: ${emailValid}`);
    log(`[DEBUG] SERVICE_ACCOUNT_RSA_KEY_VALID: ${keyValid}`);
  }
  log(`[DEBUG] FIRESTORE_PROJECT_ID_FORMAT_VALID: ${projectIds.length > 0 && projectIds.every(value => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value))}`);
  log(`[DEBUG] FIRESTORE_LOCATION_FORMAT_VALID: ${/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(env.WORKSPACE_FIRESTORE_LOCATION || '')}`);
  log(`[DEBUG] FIRESTORE_DATABASE_FORMAT_VALID: ${/^(?:\(default\)|[a-z][a-z0-9-]{0,61}[a-z0-9])$/.test(env.WORKSPACE_FIRESTORE_DATABASE || '(default)')}`);
  log(`[DEBUG] EMAIL_DELIVERY_KEY_FORMAT_VALID: ${!env.WORKSPACE_EMAIL_DELIVERY_KEY || /^[a-f0-9]{64}$/i.test(env.WORKSPACE_EMAIL_DELIVERY_KEY)}`);
}

async function main() {
  logBootstrapPreflight();
  const email = parseEmailArgument(process.argv.slice(2));
  if (!email) throw new Error('uso: node scripts/firestore-bootstrap-owner.mjs --email=dono@exemplo.com');
  const environment = requiredEnv('APP_ENV');
  const installationId = requiredEnv('WORKSPACE_INSTALLATION_ID');
  const secret = requiredEnv('WORKSPACE_HMAC_SECRET');
  validateBootstrapIdentity({ environment, installationId, secret });
  const settings = loadFirestoreSettings(process.env);
  if (settings.mode === 'gas') throw new Error('defina WORKSPACE_STORAGE_MODE=firestore (ou shadow) antes de rodar este script');

  let db;
  try { db = createFirestoreDb({ firestore: settings }); }
  catch (error) {
    // SDK messages can include credential paths or other sensitive configuration.
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : 'SDK_INITIALIZATION_FAILED';
    console.error(JSON.stringify({ event: 'firestore_client_initialization_failed', code }));
    throw new Error('FIRESTORE_CLIENT_INITIALIZATION_FAILED');
  }
  const result = await bootstrapOwner({ db, email, environment, installationId, secret });
  console.log(result.created
    ? `Conta criada: ${result.id}. Use "Primeiro acesso" em acesso-dev.html com este e-mail.`
    : `Conta existente conferida: ${result.id}. O estado de ativação foi preservado.`);
}

// A plain `file://${process.argv[1]}` string breaks for any path containing
// a space (this project's own root folder has one): import.meta.url
// percent-encodes it, the template string does not, so main() would
// silently never run. pathToFileURL() encodes both sides the same way.
const isDirectRun = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(error => {
    console.error(`FALHA: ${error.message || error}`);
    process.exitCode = 1;
  });
}
