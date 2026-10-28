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
