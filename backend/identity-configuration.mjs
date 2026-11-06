import { ApiError } from './errors.mjs';
// Fixed variable names and issue codes only. Never return values, hashes or lengths.
const KEYS = Object.freeze([
  "WORKSPACE_SESSION_TOKEN_KEY",
  "WORKSPACE_AUTH_GUARD_KEY",
  "WORKSPACE_PIN_PEPPER",
]);
const valid = (value) =>
  typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/i.test(value);
export function identityConfigurationIssues(env) {
  const names = [...KEYS, "WORKSPACE_HMAC_SECRET"];
  return KEYS.flatMap((variable) => {
    const value = env[variable];
    const issue =
      value === undefined || value === ""
        ? "MISSING"
        : !valid(value)
          ? "INVALID_FORMAT"
          : names.some(
                (other) =>
                  other !== variable &&
                  valid(env[other]) &&
                  value.toLowerCase() === env[other].toLowerCase(),
              )
            ? "REUSED"
            : null;
    return issue ? [{ variable, issue }] : [];
  });
}
export function requireProductionIdentityCredentials(env) {
  if (env.APP_ENV !== 'prod') return;
  const issue = identityConfigurationIssues(env)[0];
  if (issue) {
    console.error(JSON.stringify({ event: 'identity_configuration_unavailable', variable: issue.variable, issue: issue.issue }));
    const error = new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
    error.variable = issue.variable;
    error.issue = issue.issue;
    throw error;
  }
}
