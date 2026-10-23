import { ApiError } from './errors.mjs';
import { loadConfig } from './config.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';

// Explicit build-time service diagnostic, NOT a public route or user identity.
// The operational activation flag is never mutated and must stay false.
export async function checkDevelopmentConnection(env = process.env, dependencies = {}) {
  if (env.WORKSPACE_VERIFY_CONNECTION !== 'true') return { checked: false };
  if (env.APP_ENV !== 'dev' || env.CONTEXT !== 'branch-deploy' || env.BRANCH !== 'dev' ||
      env.WORKSPACE_BACKEND_ENABLED !== 'false') throw new ApiError(503, 'DEV_CHECK_NOT_ALLOWED');
  // Reuse full URL, key and resource validation; a local copy validates bindings
  // without activating routes or weakening loadConfig's normal activation gate.
  const settings = loadConfig({ ...env, WORKSPACE_BACKEND_ENABLED: 'true' });
  const factory = dependencies.createWorkspaceClient || createWorkspaceClient;
  const result = await factory(settings).ping();
  if (result?.ready !== true || result.environment !== 'dev' || result.schemaVersion !== 1) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
  return { checked: true, environment: 'dev', schemaVersion: 1 };
}
