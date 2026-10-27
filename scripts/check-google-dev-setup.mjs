// Read-only configuration preflight. This never connects to Google or activates flags.
import { fileURLToPath } from "node:url";
import { loadConfig } from "../backend/config.mjs";
import { loadOwnerAccessSettings } from "../backend/owner-access.mjs";
import { loadPersonalDataSettings } from "../backend/personal-data.mjs";

export const SECRET_NAMES = Object.freeze([
  "WORKSPACE_HMAC_SECRET",
  "WORKSPACE_SESSION_TOKEN_KEY",
  "WORKSPACE_AUTH_GUARD_KEY",
  "WORKSPACE_PIN_PEPPER",
  "WORKSPACE_PERSONAL_DATA_KEY",
  "WORKSPACE_PERSONAL_INDEX_KEY",
]);
export const IDENTITY_FLAGS = Object.freeze([
  "WORKSPACE_IDENTITY_SESSIONS_ENABLED",
  "WORKSPACE_IDENTITY_GUARDS_ENABLED",
  "WORKSPACE_IDENTITY_PASSKEYS_ENABLED",
  "WORKSPACE_IDENTITY_ACCESS_ENABLED",
]);
export const MODULE_FLAGS = Object.freeze([
  "WORKSPACE_CATALOG_ENABLED",
  "WORKSPACE_COVER_PHOTOS_ENABLED",
  "WORKSPACE_CHECKOUT_ENABLED",
  "WORKSPACE_NOTIFICATIONS_ENABLED",
  "WORKSPACE_STAFF_ENABLED",
  "WORKSPACE_CUSTOMERS_ENABLED",
  "WORKSPACE_OPERATIONS_ENABLED",
  "WORKSPACE_PROFILE_ENABLED",
  "WORKSPACE_RECOVERY_ENABLED",
  "WORKSPACE_EMAIL_CHANGE_ENABLED",
  "WORKSPACE_NICHES_ENABLED",
  "WORKSPACE_SCHEDULES_ENABLED",
  "WORKSPACE_AUDIT_ENABLED",
  "WORKSPACE_REPORTS_ENABLED",
  "WORKSPACE_CUSTOMER_INSIGHTS_ENABLED",
  "WORKSPACE_KEY_MANAGEMENT_ENABLED",
  "WORKSPACE_EMERGENCY_RECOVERY_ENABLED",
]);
const BASE_NAMES = [
  "APP_ENV",
  "CONTEXT",
  "BRANCH",
  "DEPLOY_PRIME_URL",
  "WORKSPACE_INSTALLATION_ID",
  "WORKSPACE_SCRIPT_URL",
  "WORKSPACE_SPREADSHEET_ID",
  "WORKSPACE_DRIVE_ROOT_ID",
  "WORKSPACE_HMAC_SECRET",
];
export function inspectGoogleDevSetup(env = process.env, phase = "service") {
  if (!["service", "identity", "modules"].includes(phase))
    throw Error("INVALID_PHASE");
  const checks = [],
    add = (code, ok, names = []) =>
      checks.push({
        code,
        status: ok ? "ok" : "blocked",
        ...(names.length ? { names } : {}),
      });
  const required = [
    ...BASE_NAMES,
    ...(phase === "service" ? [] : SECRET_NAMES.slice(1, 4)),
    ...(phase === "modules" ? SECRET_NAMES.slice(4) : []),
  ];
  const missing = required.filter(
    (name) => typeof env[name] !== "string" || !env[name],
  );
  add("REQUIRED_CONFIGURATION", missing.length === 0, missing);
  add(
    "DEV_BRANCH_CONTEXT",
    env.APP_ENV === "dev" &&
      env.CONTEXT === "branch-deploy" &&
      env.BRANCH === "dev",
  );
  add(
    "OPERATION_GATE",
    env.WORKSPACE_BACKEND_ENABLED === (phase === "service" ? "false" : "true"),
  );
  const flagNames = [
    "WORKSPACE_BACKEND_ENABLED",
    "WORKSPACE_VERIFY_CONNECTION",
    "WORKSPACE_ISBN_LOOKUP_ENABLED",
    ...IDENTITY_FLAGS,
    ...MODULE_FLAGS,
  ];
  const invalidFlags = flagNames.filter(
    (k) => env[k] !== undefined && !["true", "false"].includes(env[k]),
  );
  add("BOOLEAN_FLAGS", invalidFlags.length === 0, invalidFlags);
  const configured = SECRET_NAMES.filter(
    (k) => typeof env[k] === "string" && env[k],
  );
  add(
    "SECRET_FORMAT",
    configured.every((k) => /^[a-f0-9]{64}$/i.test(env[k])),
  );
  add(
    "INDEPENDENT_KEYS",
    new Set(configured.map((k) => env[k].toLowerCase())).size ===
      configured.length,
  );
  let valid = false;
  try {
    loadConfig({ ...env, WORKSPACE_BACKEND_ENABLED: "true" });
    valid = true;
  } catch {}
  add("SERVICE_BINDINGS_FORMAT", valid);
  if (phase !== "service") {
    const off = IDENTITY_FLAGS.filter((k) => env[k] !== "true");
    add("IDENTITY_FLAGS", off.length === 0, off);
    let identity = false;
    try {
      loadOwnerAccessSettings(env);
      identity = true;
    } catch {}
    add("IDENTITY_SETTINGS", identity);
    add(
      "BUILD_DIAGNOSTIC_DISABLED_AFTER_ACTIVATION",
      env.WORKSPACE_VERIFY_CONNECTION !== "true",
    );
  }
  if (phase === "modules") {
    const off = MODULE_FLAGS.filter((k) => env[k] !== "true");
    add("MODULE_FLAGS", off.length === 0, off);
    let vault = false;
    try {
      loadPersonalDataSettings(env);
      vault = true;
    } catch {}
    add("PERSONAL_DATA_SETTINGS", vault);
  }
  return {
    environment: "dev",
    phase,
    configurationValid: checks.every((c) => c.status === "ok"),
    networkChecked: false,
    googleHomologated: false,
    checks,
  };
}
export function runSetupCheck(
  args = process.argv.slice(2),
  env = process.env,
  log = console.log,
) {
  let phase = "service";
  if (args.length) {
    if (
      args.length !== 2 ||
      args[0] !== "--phase" ||
      !["service", "identity", "modules"].includes(args[1])
    ) {
      log("GOOGLE_DEV_SETUP_INVALID_ARGUMENT");
      return 2;
    }
    phase = args[1];
  }
  const report = inspectGoogleDevSetup(env, phase);
  log(JSON.stringify(report));
  return report.configurationValid ? 0 : 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = runSetupCheck();
