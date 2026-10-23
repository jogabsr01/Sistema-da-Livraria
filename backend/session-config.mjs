import { ApiError } from './errors.mjs';
import { loadConfig } from './config.mjs';
export function loadSessionSettings(env = process.env) {
  if (env.WORKSPACE_IDENTITY_SESSIONS_ENABLED !== 'true') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const config = loadConfig(env);
  const key = env.WORKSPACE_SESSION_TOKEN_KEY;
  if (config.environment !== 'dev' || typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key) || key.toLowerCase() === config.secret.toLowerCase()) {
    throw new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
  }
  return { config, tokenKey: Buffer.from(key, 'hex') };
}
