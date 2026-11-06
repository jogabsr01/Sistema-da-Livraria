import { ApiError } from './errors.mjs';
import { deploymentMetadata } from './deployment-metadata.mjs';
import { loadFirestoreSettings } from './firestore-config.mjs';
import { loadLocalLabPolicy, devOrigin } from './local-lab-policy.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE = /^[A-Za-z0-9_-]{20,160}$/;
function invalid(env, fields = []) {
  if (env?.APP_ENV === 'prod') {
    for (const field of fields) console.error(JSON.stringify({ event: 'configuration_unavailable', variable: field, issue: env[field] == null || env[field] === '' ? 'MISSING' : 'INVALID' }));
    if (!fields.length) console.error(JSON.stringify({ event: 'configuration_unavailable', issue: 'DEPLOYMENT_METADATA_INVALID' }));
  }
  throw new ApiError(503, 'CONFIGURATION_UNAVAILABLE');
}
export function loadConfig(env = process.env, built = env === process.env ? deploymentMetadata : null) {
  const local = env.WORKSPACE_LOCAL_LAB ? loadLocalLabPolicy(env) : null;
  // Only build-generated server metadata can supply missing Netlify build variables.
  // Never infer deployment identity from a request, Host or forwarded headers.
  if (built !== null && !local) {
    if (built.version !== 1 || !built.siteId) invalid(env);
    if (env.SITE_ID !== built.siteId) invalid(env, ['SITE_ID']);
    const fields = { CONTEXT: built.context, BRANCH: built.branch, DEPLOY_PRIME_URL: built.deploymentUrl };
    const invalidFields = Object.entries(fields).filter(([key,value]) => {
      if (typeof value !== 'string' || !value) return true;
      if (env[key] == null || env[key] === '') return false;
      if (key !== 'DEPLOY_PRIME_URL') return env[key] !== value;
      try { return new URL(env[key]).href !== value; } catch { return true; }
    }).map(([key]) => key);
    if (invalidFields.length) invalid(env, invalidFields);
    env = { ...env, ...fields };
  }
  if (env.WORKSPACE_BACKEND_ENABLED !== 'true') throw new ApiError(503, 'SERVICE_NOT_ACTIVATED');
  const environment = env.APP_ENV;
  if (!['dev', 'prod'].includes(environment)) invalid(env, ['APP_ENV']);
  const expectedHost = new URL(devOrigin({ APP_ENV: environment, VERCEL: env.VERCEL })).hostname;
  // Netlify build variables are not guaranteed in Functions. Missing context
  // and branch inherit the selected environment, never request-derived input.
  env = { ...env, CONTEXT: env.CONTEXT || (environment === 'prod' ? 'production' : 'branch-deploy'),
    BRANCH: env.BRANCH || (environment === 'prod' ? 'main' : 'dev'),
    DEPLOY_PRIME_URL: env.DEPLOY_PRIME_URL || env.URL || `https://${expectedHost}` };
  const validContext = environment === 'dev'
    ? env.CONTEXT === 'branch-deploy' && env.BRANCH === 'dev'
    : env.CONTEXT === 'production' && env.BRANCH === 'main';
  if (!local && !validContext) invalid(env, ['CONTEXT', 'BRANCH'].filter(key => env[key] !== (environment === 'dev' ? { CONTEXT:'branch-deploy', BRANCH:'dev' } : { CONTEXT:'production', BRANCH:'main' })[key]));
  const firestore = loadFirestoreSettings(env);
  let deployment, script;
  try { deployment = new URL(local ? local.origin : env.DEPLOY_PRIME_URL); } catch { invalid(env, ['DEPLOY_PRIME_URL']); }
  try { script = firestore.mode === 'firestore' ? null : new URL(env.WORKSPACE_SCRIPT_URL); } catch { invalid(env, ['WORKSPACE_SCRIPT_URL']); }
  if (!local && (deployment.protocol !== 'https:' || deployment.hostname !== expectedHost || deployment.port || deployment.username || deployment.password || deployment.pathname !== '/' || deployment.search || deployment.hash)) invalid(env, ['DEPLOY_PRIME_URL']);
  if (script && (script.protocol !== 'https:' || script.hostname !== 'script.google.com' || script.port || script.username || script.password || script.search || script.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(script.pathname))) invalid(env, ['WORKSPACE_SCRIPT_URL']);
  const invalidBindings = [['WORKSPACE_INSTALLATION_ID', UUID], ['WORKSPACE_DRIVE_ROOT_ID', RESOURCE], ['WORKSPACE_HMAC_SECRET', /^[a-f0-9]{64}$/i], ...(firestore.mode !== 'firestore' ? [['WORKSPACE_SPREADSHEET_ID', RESOURCE]] : [])].filter(([key, pattern]) => !pattern.test(env[key] || '')).map(([key]) => key);
  if (invalidBindings.length) invalid(env, invalidBindings);
  const passwordPolicy=env.WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED ?? env.WORKSPACE_ADMIN_PIN_LOGIN_ENABLED;
  if(passwordPolicy!==undefined&&!['true','false'].includes(passwordPolicy))invalid(env, [env.WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED !== undefined ? 'WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED' : 'WORKSPACE_ADMIN_PIN_LOGIN_ENABLED']);
  const adminPasswordLogin=environment==='dev'&&passwordPolicy!=='false';
  return Object.freeze({ environment, storageMode: firestore.mode, firestore, localLab: !!local, adminPasswordLogin, adminPinLogin: adminPasswordLogin,
    keyManagementEnabled: env.WORKSPACE_KEY_MANAGEMENT_ENABLED === 'true',
    emergencyRecoveryEnabled: env.WORKSPACE_EMERGENCY_RECOVERY_ENABLED === 'true' && env.WORKSPACE_RECOVERY_ENABLED === 'true',
    installationId: env.WORKSPACE_INSTALLATION_ID,
    scriptUrl: script?.href || null, spreadsheetId: env.WORKSPACE_SPREADSHEET_ID || null,
    driveRootId: env.WORKSPACE_DRIVE_ROOT_ID, secret: env.WORKSPACE_HMAC_SECRET });
}
