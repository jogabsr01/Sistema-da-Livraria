import { ApiError } from './errors.mjs';

const STORAGE_MODES = new Set(['gas', 'shadow', 'firestore']);
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{0,61}[a-z0-9])$/;
const LOCATION = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const EMULATOR_HOST = /^(?:\[[0-9a-f:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/i;

function unavailable() {
  throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
}

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function storageMode(env) {
  const mode = env.WORKSPACE_STORAGE_MODE ?? 'gas';
  if (!STORAGE_MODES.has(mode)) unavailable();
  return mode;
}

function parseCredentials(value) {
  if (!text(value)) return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch { unavailable(); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      typeof parsed.client_email !== 'string' || !parsed.client_email ||
      typeof parsed.private_key !== 'string' || !parsed.private_key ||
      typeof parsed.project_id !== 'string' || !PROJECT_ID.test(parsed.project_id)) unavailable();
  return Object.freeze({
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
  });
}

function validateEmulator(value) {
  if (!text(value)) return null;
  if (!EMULATOR_HOST.test(value)) unavailable();
  const port = Number(value.slice(value.lastIndexOf(':') + 1));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) unavailable();
  return value;
}

export function loadFirestoreSettings(env = process.env) {
  const mode = storageMode(env);
  if (mode === 'gas') return Object.freeze({ mode });

  const projectId = text(env.WORKSPACE_FIRESTORE_PROJECT_ID);
  const databaseId = env.WORKSPACE_FIRESTORE_DATABASE || '(default)';
  const location = text(env.WORKSPACE_FIRESTORE_LOCATION);
  const emulatorHost = validateEmulator(env.FIRESTORE_EMULATOR_HOST);
  const credentials = parseCredentials(env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON);
  const applicationCredentials = text(env.GOOGLE_APPLICATION_CREDENTIALS);
  const emailProvider = text(env.WORKSPACE_EMAIL_PROVIDER);
  const emailProviderKey = text(env.WORKSPACE_EMAIL_PROVIDER_KEY);
  const emailFrom = text(env.WORKSPACE_EMAIL_FROM) || (emailProvider === 'resend' ? 'Livraria IPB DEV <onboarding@resend.dev>' : null);
  const emailDeliveryKeyValue = text(env.WORKSPACE_EMAIL_DELIVERY_KEY);
  if (emailDeliveryKeyValue && !/^[a-f0-9]{64}$/i.test(emailDeliveryKeyValue)) unavailable();
  const emailDeliveryKey = emailDeliveryKeyValue ? Buffer.from(emailDeliveryKeyValue, 'hex') : null;

  if (!projectId || !PROJECT_ID.test(projectId) || !DATABASE_ID.test(databaseId) ||
      !location || !LOCATION.test(location) || credentials && credentials.project_id !== projectId ||
      !emulatorHost && !credentials && !applicationCredentials) unavailable();

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

export function isFirestoreMode(config) {
  return ['firestore', 'shadow'].includes(config?.storageMode ?? config?.mode);
}
