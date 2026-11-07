import { ApiError } from './errors.mjs';
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const STORAGE_MODES = new Set(['gas', 'shadow', 'firestore']);
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{0,61}[a-z0-9])$/;
const LOCATION = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const EMULATOR_HOST = /^(?:\[[0-9a-f:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/i;

function unavailable(reason) {
  console.log('REJECTION REASON:', reason);
  throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
}

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function storageMode(env) {
  const mode = env.WORKSPACE_STORAGE_MODE ?? 'gas';
  if (!STORAGE_MODES.has(mode)) unavailable('INVALID_STORAGE_MODE');
  return mode;
}

export function parseServiceAccountJson(value) {
  if (!text(value)) throw new Error('MALFORMED_JSON');
  let source = value.trim(), parsed;
  try { parsed = JSON.parse(source); }
  catch {
    if ((source.startsWith("'") && source.endsWith("'")) || (source.startsWith('"{') && source.endsWith('}"'))) source = source.slice(1, -1);
    // dotenv loaders can turn JSON-escaped newlines into literal line breaks
    // inside the PEM string. Repair only that field; reject all other malformed JSON.
    const repaired = source.replace(/("private_key"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)(")/g,
      (_match, prefix, key, suffix) => prefix + key.replace(/\r\n|\r|\n/g, '\\n') + suffix);
    try { parsed = JSON.parse(repaired); } catch { throw new Error('MALFORMED_JSON'); }
  }
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { throw new Error('MALFORMED_JSON'); }
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('MALFORMED_JSON');
  return parsed;
}

export function readServiceAccountSource(env = process.env) {
  if (text(env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON)) return env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON;
  if (!text(env.GOOGLE_APPLICATION_CREDENTIALS)) return null;
  try { return readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'); }
  catch { throw new Error('CREDENTIAL_FILE_UNAVAILABLE'); }
}

function parseCredentials(value) {
  if (!text(value)) return null;
  let parsed;
  try { parsed = parseServiceAccountJson(value); } catch { unavailable('MALFORMED_SERVICE_ACCOUNT_JSON'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      typeof parsed.client_email !== 'string' || !parsed.client_email ||
      typeof parsed.private_key !== 'string' || !parsed.private_key ||
      typeof parsed.project_id !== 'string' || !PROJECT_ID.test(parsed.project_id)) unavailable('INVALID_SERVICE_ACCOUNT_FIELDS');
  return Object.freeze({
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
    project_id: parsed.project_id,
  });
}

function validateEmulator(value) {
  if (!text(value)) return null;
  if (!EMULATOR_HOST.test(value)) unavailable('INVALID_EMULATOR_HOST');
  const port = Number(value.slice(value.lastIndexOf(':') + 1));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) unavailable('INVALID_EMULATOR_PORT');
  return value;
}

function readFirestoreSettings(env) {
  const mode = storageMode(env);
  if (mode === 'gas') return Object.freeze({ mode });

  const projectId = text(env.WORKSPACE_FIRESTORE_PROJECT_ID);
  const databaseId = env.WORKSPACE_FIRESTORE_DATABASE || '(default)';
  const location = text(env.WORKSPACE_FIRESTORE_LOCATION);
  const emulatorHost = validateEmulator(env.FIRESTORE_EMULATOR_HOST);
  // Never direct a deployed or production process to an emulator, even when
  // credentials are also configured. Local test environments remain supported.
  if (emulatorHost && (env.NETLIFY === 'true' || env.APP_ENV === 'prod')) unavailable('EMULATOR_FORBIDDEN');
  let source;
  try { source = readServiceAccountSource(env); } catch { unavailable('CREDENTIAL_FILE_UNAVAILABLE'); }
  const credentials = parseCredentials(source);
  if (env.APP_ENV === 'prod' && credentials) {
    try {
      if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(credentials.client_email)) unavailable('INVALID_SERVICE_ACCOUNT_EMAIL');
      if (createPrivateKey(credentials.private_key).asymmetricKeyType !== 'rsa') unavailable('INVALID_SERVICE_ACCOUNT_KEY');
    } catch (error) { if (error instanceof ApiError) throw error; unavailable('INVALID_SERVICE_ACCOUNT_KEY'); }
  }
  const applicationCredentials = text(env.GOOGLE_APPLICATION_CREDENTIALS);
  const emailProvider = text(env.WORKSPACE_EMAIL_PROVIDER);
  const emailProviderKey = text(env.WORKSPACE_EMAIL_PROVIDER_KEY);
  const emailFrom = text(env.WORKSPACE_EMAIL_FROM) || (emailProvider === 'resend' ? 'Livraria IPB <onboarding@resend.dev>' : null);
  const emailDeliveryKeyValue = text(env.WORKSPACE_EMAIL_DELIVERY_KEY);
  if (emailDeliveryKeyValue && !/^[a-f0-9]{64}$/i.test(emailDeliveryKeyValue)) unavailable('INVALID_EMAIL_DELIVERY_KEY');
  const emailDeliveryKey = emailDeliveryKeyValue ? Buffer.from(emailDeliveryKeyValue, 'hex') : null;

  if (!projectId || !PROJECT_ID.test(projectId)) unavailable('INVALID_PROJECT_ID');
  if (!DATABASE_ID.test(databaseId)) unavailable('INVALID_DATABASE_ID');
  if (!location || !LOCATION.test(location)) unavailable('INVALID_LOCATION');
  if (credentials && credentials.project_id !== projectId) unavailable('MISMATCHED_PROJECT_ID');
  if (!emulatorHost && !credentials && !applicationCredentials) unavailable('MISSING_CREDENTIALS');

  return Object.freeze({
    mode,
    projectId,
    databaseId,
    location,
    emulatorHost,
    credentials,
    applicationCredentials,
    emailProvider,
    emailProviderKey,
    emailFrom,
    emailDeliveryKey,
  });
}

export function loadFirestoreSettings(env = process.env) {
  try { return readFirestoreSettings(env); }
  catch (error) {
    if (env.APP_ENV === 'prod' && error?.code === 'FIRESTORE_CONFIGURATION_UNAVAILABLE') {
      const fields = [];
      if (!STORAGE_MODES.has(env.WORKSPACE_STORAGE_MODE ?? 'gas')) fields.push('WORKSPACE_STORAGE_MODE');
      if (env.WORKSPACE_STORAGE_MODE !== 'gas') {
        if (!PROJECT_ID.test(env.WORKSPACE_FIRESTORE_PROJECT_ID || '')) fields.push('WORKSPACE_FIRESTORE_PROJECT_ID');
        if (!LOCATION.test(env.WORKSPACE_FIRESTORE_LOCATION || '')) fields.push('WORKSPACE_FIRESTORE_LOCATION');
        if (env.WORKSPACE_FIRESTORE_DATABASE && !DATABASE_ID.test(env.WORKSPACE_FIRESTORE_DATABASE)) fields.push('WORKSPACE_FIRESTORE_DATABASE');
        if (env.FIRESTORE_EMULATOR_HOST) fields.push('FIRESTORE_EMULATOR_HOST');
        if (!env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON && !env.GOOGLE_APPLICATION_CREDENTIALS) fields.push('WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS');
        else if (env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON) {
          try {
            const c = parseCredentials(env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON);
            if (!c || c.project_id !== env.WORKSPACE_FIRESTORE_PROJECT_ID || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(c.client_email) || createPrivateKey(c.private_key).asymmetricKeyType !== 'rsa') fields.push('WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON');
          } catch { fields.push('WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON'); }
        }
        if (env.WORKSPACE_EMAIL_DELIVERY_KEY && !/^[a-f0-9]{64}$/i.test(env.WORKSPACE_EMAIL_DELIVERY_KEY)) fields.push('WORKSPACE_EMAIL_DELIVERY_KEY');
      }
      for (const field of fields) console.error(JSON.stringify({ event: 'firestore_configuration_unavailable', variable: field, issue: env[field] == null || env[field] === '' ? 'MISSING' : 'INVALID' }));
      if (!fields.length) console.error(JSON.stringify({ event: 'firestore_configuration_unavailable', issue: 'INVALID' }));
    }
    throw error;
  }
}

export function isFirestoreMode(config) {
  return ['firestore', 'shadow'].includes(config?.storageMode ?? config?.mode);
}
