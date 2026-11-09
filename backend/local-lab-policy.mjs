// Explicit opt-in is always validated; invalid laboratory configurations fail closed.
export function loadLocalLabPolicy(env = process.env) {
  const forbidden = ['NETLIFY', 'NETLIFY_LOCAL', 'SITE_ID', 'SITE_NAME', 'CONTEXT', 'BRANCH', 'DEPLOY_ID', 'DEPLOY_URL', 'DEPLOY_PRIME_URL', 'URL',
    'GOOGLE_APPLICATION_CREDENTIALS', 'WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON', 'WORKSPACE_FIREBASE_SERVICE_ACCOUNT_JSON', 'WORKSPACE_EMAIL_PROVIDER', 'WORKSPACE_EMAIL_PROVIDER_KEY'];
  const project = env.WORKSPACE_FIRESTORE_PROJECT_ID;
  if (env.WORKSPACE_LOCAL_LAB !== 'YES' || env.APP_ENV !== 'dev' || env.WORKSPACE_STORAGE_MODE !== 'firestore' ||
      env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || typeof project !== 'string' ||
      !/^demo-[a-z0-9](?:[a-z0-9-]{0,23}[a-z0-9])?$/.test(project) ||
      forbidden.some(name => typeof env[name] === 'string' && env[name] !== '')) {
    throw Error('LOCAL_LAB_DENIED');
  }
  return Object.freeze({ origin: 'https://localhost:8443', rpId: 'localhost', projectId: project,
    emulatorHost: '127.0.0.1:8080' });
}

export const PRODUCTION_ORIGIN = 'https://merry-chimera-49a1f3.netlify.app';
export const VERCEL_PRODUCTION_ORIGIN = 'https://livrariaipjb.vercel.app';
export const DEVELOPMENT_ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function devOrigin(env = process.env) {
  if (env.WORKSPACE_LOCAL_LAB !== undefined && env.WORKSPACE_LOCAL_LAB !== '') return loadLocalLabPolicy(env).origin;
  if (env.APP_ENV === 'prod') return env.VERCEL === '1' ? VERCEL_PRODUCTION_ORIGIN : PRODUCTION_ORIGIN;
  if (env.APP_ENV === undefined || env.APP_ENV === '' || env.APP_ENV === 'dev') return DEVELOPMENT_ORIGIN;
  throw Error('ORIGIN_CONFIGURATION_INVALID');
}

export function devRpId(env = process.env) {
  return new URL(devOrigin(env)).hostname;
}