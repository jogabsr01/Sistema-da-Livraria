import { fileURLToPath } from 'node:url';
import { checkDevelopmentConnection } from '../backend/connection-check.mjs';
import { ApiError } from '../backend/errors.mjs';
export async function runCheck(env = process.env, { check = checkDevelopmentConnection, log = console.log } = {}) {
  try {
    const result = await check(env);
    if (result.checked) log('GOOGLE_DEV_CONNECTION_OK schemaVersion=1; operational backend remains disabled.');
    return 0;
  } catch (error) {
    // Never print upstream bodies, keys, IDs or arbitrary exception messages.
    const allowed = ['DEV_CHECK_NOT_ALLOWED', 'CONFIGURATION_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE',
      'UPSTREAM_UNTRUSTED', 'WORKSPACE_REPLAY', 'WORKSPACE_BUSY', 'WORKSPACE_SCHEMA_REQUIRED', 'WORKSPACE_FORBIDDEN', 'WORKSPACE_BINDING_MISMATCH'];
    const code = error instanceof ApiError && allowed.includes(error.code) ? error.code : 'DEV_CHECK_FAILED';
    log(`GOOGLE_DEV_CONNECTION_FAILED ${code}; operational backend remains disabled.`);
    return 1;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await runCheck();
