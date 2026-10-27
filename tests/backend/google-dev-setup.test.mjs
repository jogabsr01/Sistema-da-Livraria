import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inspectGoogleDevSetup,
  runSetupCheck,
  SECRET_NAMES,
  IDENTITY_FLAGS,
  MODULE_FLAGS,
} from "../../scripts/check-google-dev-setup.mjs";

function fixture(phase = "service") {
  const env = {
    APP_ENV: "dev",
    CONTEXT: "branch-deploy",
    BRANCH: "dev",
    DEPLOY_PRIME_URL: "https://dev--merry-chimera-49a1f3.netlify.app",
    WORKSPACE_INSTALLATION_ID: "12345678-1234-4123-8123-123456789abc",
    WORKSPACE_SCRIPT_URL:
      "https://script.google.com/macros/s/test-deployment/exec",
    WORKSPACE_SPREADSHEET_ID: "s".repeat(24),
    WORKSPACE_DRIVE_ROOT_ID: "d".repeat(24),
    WORKSPACE_BACKEND_ENABLED: phase === "service" ? "false" : "true",
    WORKSPACE_VERIFY_CONNECTION: "false",
  };
  SECRET_NAMES.forEach(
    (name, i) => (env[name] = (i + 1).toString(16).repeat(64)),
  );
  [...IDENTITY_FLAGS, ...MODULE_FLAGS].forEach(
    (name) => (env[name] = phase === "service" ? "false" : "true"),
  );
  return env;
}

test("offline preflight validates staged DEV settings without activation, network or mutation", () => {
  for (const phase of ["service", "identity", "modules"]) {
    const env = Object.freeze(fixture(phase)),
      before = JSON.stringify(env),
      report = inspectGoogleDevSetup(env, phase);
    assert.equal(report.configurationValid, true);
    assert.equal(report.networkChecked, false);
    assert.equal(report.googleHomologated, false);
    assert.equal(JSON.stringify(env), before);
  }
});
test("preflight rejects wrong context, malformed bindings and operation gate", () => {
  for (const patch of [
    { APP_ENV: "prod" },
    { BRANCH: "main" },
    { CONTEXT: "deploy-preview" },
    { DEPLOY_PRIME_URL: "https://attacker.example" },
    { WORKSPACE_SCRIPT_URL: "https://script.google.com/macros/s/test/dev" },
    { WORKSPACE_BACKEND_ENABLED: "true" },
    { WORKSPACE_INSTALLATION_ID: "invalid" },
  ])
    assert.equal(
      inspectGoogleDevSetup({ ...fixture(), ...patch }).configurationValid,
      false,
    );
});
test("preflight blocks missing, reused, malformed keys and invalid flags", () => {
  const env = fixture("modules");
  for (const name of SECRET_NAMES) {
    const changed = { ...env };
    delete changed[name];
    assert.equal(
      inspectGoogleDevSetup(changed, "modules").configurationValid,
      false,
    );
  }
  assert.equal(
    inspectGoogleDevSetup(
      {
        ...env,
        WORKSPACE_PERSONAL_DATA_KEY: env.WORKSPACE_HMAC_SECRET.toUpperCase(),
      },
      "modules",
    ).configurationValid,
    false,
  );
  assert.equal(
    inspectGoogleDevSetup(
      { ...env, WORKSPACE_AUTH_GUARD_KEY: "not-a-key" },
      "modules",
    ).configurationValid,
    false,
  );
  assert.equal(
    inspectGoogleDevSetup(
      { ...env, WORKSPACE_REPORTS_ENABLED: "TRUE" },
      "modules",
    ).configurationValid,
    false,
  );
});
test("activation requires identity dependencies and disables build handshake", () => {
  const env = fixture("identity");
  for (const name of IDENTITY_FLAGS)
    assert.equal(
      inspectGoogleDevSetup({ ...env, [name]: "false" }, "identity")
        .configurationValid,
      false,
    );
  assert.equal(
    inspectGoogleDevSetup(
      { ...env, WORKSPACE_VERIFY_CONNECTION: "true" },
      "identity",
    ).configurationValid,
    false,
  );
  for (const name of MODULE_FLAGS)
    assert.equal(
      inspectGoogleDevSetup(
        { ...fixture("modules"), [name]: "false" },
        "modules",
      ).configurationValid,
      false,
    );
});
test("preflight output never reflects arbitrary values or invalid CLI arguments", () => {
  const sentinel = "PRIVATE-VALUE-DO-NOT-LOG",
    env = fixture("modules");
  for (const key of Object.keys(env)) env[key] = sentinel;
  const logs = [];
  assert.equal(
    runSetupCheck(["--phase", "modules"], env, (v) => logs.push(v)),
    1,
  );
  assert.equal(
    runSetupCheck(["--phase", sentinel], env, (v) => logs.push(v)),
    2,
  );
  assert.equal(logs.join("").includes(sentinel), false);
  const empty = inspectGoogleDevSetup({});
  assert.equal(empty.configurationValid, false);
  assert.ok(
    empty.checks
      .find((c) => c.code === "REQUIRED_CONFIGURATION")
      .names.includes("WORKSPACE_HMAC_SECRET"),
  );
});
test("empty configuration template covers keys and flags without enabling modules", () => {
  const lines = readFileSync(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((s) => s && !s.startsWith("#"));
  const pairs = lines.map((s) => s.split("="));
  const env = Object.fromEntries(pairs);
  assert.equal(new Set(pairs.map(([k]) => k)).size, pairs.length);
  for (const name of SECRET_NAMES) assert.equal(env[name], "");
  for (const name of [
    ...IDENTITY_FLAGS,
    ...MODULE_FLAGS,
    "WORKSPACE_BACKEND_ENABLED",
    "WORKSPACE_VERIFY_CONNECTION",
  ])
    assert.equal(env[name], "false");
});
