import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDeploymentMetadata,
  writeDeploymentMetadata,
  EMPTY_METADATA,
} from "../../scripts/build-deployment-metadata.mjs";
import { loadConfig } from "../../backend/config.mjs";
import { environment } from "./fixtures.mjs";
const siteId = "12345678-1234-4123-8123-123456789abc";
const buildEnv = () => ({ ...environment(), NETLIFY: "true", SITE_ID: siteId });
const runtime = () => {
  const env = buildEnv();
  for (const k of ["CONTEXT", "BRANCH", "DEPLOY_PRIME_URL", "NETLIFY"])
    delete env[k];
  return env;
};

test("realistic Functions environment resolves pinned deployment from private build metadata without mutation", () => {
  const env = Object.freeze(runtime()),
    before = JSON.stringify(env),
    meta = buildDeploymentMetadata(buildEnv());
  assert.throws(() => loadConfig(env), { code: "CONFIGURATION_UNAVAILABLE" });
  assert.equal(loadConfig(env, meta).environment, "dev");
  assert.equal(loadConfig(buildEnv(), meta).environment, "dev");
  assert.equal(JSON.stringify(env), before);
});
test("runtime metadata cannot authorize preview, wrong branch, hostname, site, environment or contradictory runtime metadata", () => {
  const env = runtime(),
    meta = buildDeploymentMetadata(buildEnv());
  for (const patch of [
    { context: "deploy-preview" },
    { branch: "feature/other" },
    { deploymentUrl: "https://attacker.example/" },
    { version: 2 },
    { siteId: "foreign" },
  ])
    assert.throws(() => loadConfig(env, { ...meta, ...patch }));
  for (const patch of [
    { SITE_ID: undefined },
    { APP_ENV: "prod" },
    { BRANCH: "main" },
    { CONTEXT: "deploy-preview" },
    { DEPLOY_PRIME_URL: "https://attacker.example" },
  ])
    assert.throws(() => loadConfig({ ...env, ...patch }, meta));
  assert.throws(
    () => loadConfig({ ...env, WORKSPACE_BACKEND_ENABLED: "false" }, meta),
    { code: "SERVICE_NOT_ACTIVATED" },
  );
});
test("build metadata is a strict identity allowlist and excludes all flags, resource bindings and keys", () => {
  const env = { ...buildEnv(), UNRELATED_PRIVATE_VALUE: "PRIVATE_SENTINEL" };
  const meta = buildDeploymentMetadata(env);
  assert.deepEqual(Object.keys(meta), [
    "version",
    "context",
    "branch",
    "deploymentUrl",
    "siteId",
  ]);
  const text = JSON.stringify(meta);
  for (const k of [
    "WORKSPACE_HMAC_SECRET",
    "WORKSPACE_INSTALLATION_ID",
    "WORKSPACE_SPREADSHEET_ID",
    "WORKSPACE_DRIVE_ROOT_ID",
    "UNRELATED_PRIVATE_VALUE",
  ])
    assert.equal(text.includes(env[k]), false);
  assert.equal(buildDeploymentMetadata({}), null);
  for (const patch of [
    { CONTEXT: undefined },
    { SITE_ID: undefined },
    { BRANCH: "" },
    { DEPLOY_PRIME_URL: "http://attacker.example/" },
    { DEPLOY_PRIME_URL: "https://user:pass@attacker.example/" },
  ])
    assert.throws(() => buildDeploymentMetadata({ ...buildEnv(), ...patch }));
});
test("generated module supplies default runtime loader without build-only environment variables", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "livraria-meta-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "backend"));
  for (const name of ["config.mjs", "errors.mjs"])
    copyFileSync(
      new URL("../../backend/" + name, import.meta.url),
      join(root, "backend", name),
    );
  writeDeploymentMetadata(root, buildEnv());
  const { loadConfig: deployed } = await import(
    pathToFileURL(join(root, "backend/config.mjs")).href
  );
  // Passing process.env explicitly exercises the same identity path as runtime loaders.
  const snapshot = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, runtime());
    assert.equal(deployed().environment, "dev");
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, snapshot);
  }
  writeDeploymentMetadata(root, {});
  assert.equal(
    readFileSync(join(root, "backend/deployment-metadata.mjs"), "utf8"),
    EMPTY_METADATA,
  );
});
