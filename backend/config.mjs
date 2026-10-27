import { ApiError } from './errors.mjs';
import { deploymentMetadata } from './deployment-metadata.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE = /^[A-Za-z0-9_-]{20,160}$/;
function invalid() { throw new ApiError(503, 'CONFIGURATION_UNAVAILABLE'); }
export function loadConfig(env = process.env, built = env === process.env ? deploymentMetadata : null) {
  // Only build-generated server metadata can supply missing Netlify build variables.
  // Never infer deployment identity from a request, Host or forwarded headers.
  if (built !== null) {
    if (built.version !== 1 || !built.siteId || env.SITE_ID !== built.siteId) invalid();
    const fields = { CONTEXT: built.context, BRANCH: built.branch, DEPLOY_PRIME_URL: built.deploymentUrl };
    if (Object.entries(fields).some(([key,value]) => {
      if (typeof value !== 'string' || !value) return true;
      if (env[key] === undefined) return false;
      if (key !== 'DEPLOY_PRIME_URL') return env[key] !== value;
      try { return new URL(env[key]).href !== value; } catch { return true; }
    })) invalid();
    env = { ...env, ...fields };
  }
  if (env.WORKSPACE_BACKEND_ENABLED !== 'true') throw new ApiError(503, 'SERVICE_NOT_ACTIVATED');
  const environment = env.APP_ENV;
  const expectedHost = environment === 'dev' ? 'dev--merry-chimera-49a1f3.netlify.app' : 'merry-chimera-49a1f3.netlify.app';
  if (!['dev', 'prod'].includes(environment)) invalid();
  const validContext = environment === 'dev'
    ? env.CONTEXT === 'branch-deploy' && env.BRANCH === 'dev'
    : env.CONTEXT === 'production' && env.BRANCH === 'main';
  if (!validContext) invalid();
  let deployment, script;
  try { deployment = new URL(env.DEPLOY_PRIME_URL); script = new URL(env.WORKSPACE_SCRIPT_URL); } catch { invalid(); }
  if (deployment.protocol !== 'https:' || deployment.hostname !== expectedHost || deployment.port || deployment.username || deployment.password || deployment.pathname !== '/' || deployment.search || deployment.hash) invalid();
  if (script.protocol !== 'https:' || script.hostname !== 'script.google.com' || script.port || script.username || script.password || script.search || script.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(script.pathname)) invalid();
  if (!UUID.test(env.WORKSPACE_INSTALLATION_ID || '') || !RESOURCE.test(env.WORKSPACE_SPREADSHEET_ID || '') || !RESOURCE.test(env.WORKSPACE_DRIVE_ROOT_ID || '') || !/^[a-f0-9]{64}$/i.test(env.WORKSPACE_HMAC_SECRET || '')) invalid();
  return Object.freeze({ environment, installationId: env.WORKSPACE_INSTALLATION_ID,
    scriptUrl: script.href, spreadsheetId: env.WORKSPACE_SPREADSHEET_ID,
    driveRootId: env.WORKSPACE_DRIVE_ROOT_ID, secret: env.WORKSPACE_HMAC_SECRET });
}
