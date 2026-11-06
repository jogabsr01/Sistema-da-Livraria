import test from "node:test";
import assert from "node:assert/strict";
import { identityConfigurationIssues } from "../../backend/identity-configuration.mjs";
import {
  createOwnerAccessHandler,
  ACCESS_ORIGIN,
} from "../../backend/owner-access.mjs";
import { ApiError } from "../../backend/errors.mjs";
import { ownerFixture } from "../helpers/owner-access-fixture.mjs";
const keys = [
  "WORKSPACE_SESSION_TOKEN_KEY",
  "WORKSPACE_AUTH_GUARD_KEY",
  "WORKSPACE_PIN_PEPPER",
];
const good = () =>
  Object.fromEntries(
    [...keys, "WORKSPACE_HMAC_SECRET"].map((name, i) => [
      name,
      (i + 1).toString(16).repeat(64),
    ]),
  );
function configure(t, values) {
  const names = ["APP_ENV", ...keys, "WORKSPACE_HMAC_SECRET"],
    snapshot = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  for (const k of names) delete process.env[k];
  Object.assign(process.env, values);
  t.after(() => {
    for (const k of names) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });
}
const unavailable = () => {
  throw new ApiError(503, "IDENTITY_CONFIGURATION_UNAVAILABLE");
};

test("identity setup issues distinguish missing, malformed and reused keys without values or mutation", () => {
  const env = Object.freeze({
      ...good(),
      [keys[0]]: undefined,
      [keys[1]]: "PRIVATE_BAD_VALUE",
      [keys[2]]: "4".repeat(64),
    }),
    before = JSON.stringify(env);
  const issues = identityConfigurationIssues(env);
  assert.deepEqual(issues, [
    { variable: keys[0], issue: "MISSING" },
    { variable: keys[1], issue: "INVALID_FORMAT" },
    { variable: keys[2], issue: "REUSED" },
  ]);
  assert.equal(JSON.stringify(issues).includes("PRIVATE_BAD_VALUE"), false);
  assert.equal(JSON.stringify(issues).includes("4".repeat(64)), false);
  assert.equal(JSON.stringify(env), before);
  assert.deepEqual(identityConfigurationIssues(good()), []);
  assert.deepEqual(identityConfigurationIssues({...good(),[keys[0]]:good()[keys[0]]+"\n"}),[{variable:keys[0],issue:"INVALID_FORMAT"}]);
  const duplicate = good();
  duplicate[keys[0]] = "AB".repeat(32);
  duplicate[keys[1]] = "ab".repeat(32);
  assert.deepEqual(identityConfigurationIssues(duplicate), [
    { variable: keys[0], issue: "REUSED" },
    { variable: keys[1], issue: "REUSED" },
  ]);
});
test("DEV state exposes only fixed setup issues and remains closed without cookie or upstream calls", async (t) => {
  configure(t, { APP_ENV: "dev", ...good(), [keys[0]]: "wrong-private-token" });
  let calls = 0;
  const handler = createOwnerAccessHandler({
    loadSettings: unavailable,
    createClient: () => {
      calls++;
    },
  });
  const response = await handler(
    new Request(ACCESS_ORIGIN + "/api/v1/access/state"),
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(body.error.code, "IDENTITY_CONFIGURATION_UNAVAILABLE");
  assert.deepEqual(body.error.configurationIssues, [
    { variable: keys[0], issue: "INVALID_FORMAT" },
  ]);
  assert.equal(JSON.stringify(body).includes("wrong-private-token"), false);
  assert.equal(Object.hasOwn(body, "data"), false);
  assert.equal(calls, 0);
});
test("production, wrong origins, methods and unrelated failures never expose setup issues", async (t) => {
  configure(t, { APP_ENV: "prod" });
  let handler = createOwnerAccessHandler({ loadSettings: unavailable });
  let response = await handler(
    new Request(ACCESS_ORIGIN + "/api/v1/access/state"),
  );
  assert.equal((await response.json()).error.configurationIssues, undefined);
  process.env.APP_ENV = "dev";
  for (const [url, method] of [
    [ACCESS_ORIGIN + "/api/v1/access/start", "POST"],
    [ACCESS_ORIGIN + "/api/v1/access/state", "POST"],
    ["https://attacker.invalid/api/v1/access/state", "GET"],
  ]) {
    response = await handler(new Request(url, { method }));
    assert.equal((await response.json()).error.configurationIssues, undefined);
  }
  handler = createOwnerAccessHandler({
    loadSettings: () => {
      throw new ApiError(503, "CONFIGURATION_UNAVAILABLE");
    },
  });
  response = await handler(new Request(ACCESS_ORIGIN + "/api/v1/access/state"));
  assert.equal((await response.json()).error.configurationIssues, undefined);
});
test("valid first-access state is unchanged and failures after settings are loaded do not expose setup checks", async (t) => {
  configure(t, { APP_ENV: "dev", ...good() });
  const s = ownerFixture();
  let handler = createOwnerAccessHandler({
    loadSettings: () => s.settings,
    createClient: () => s.client,
  });
  let response = await handler(
    new Request(ACCESS_ORIGIN + "/api/v1/access/state"),
  );
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.stage, "INITIAL");
  assert.equal(body.error, undefined);
  handler = createOwnerAccessHandler({
    loadSettings: () => s.settings,
    createClient: unavailable,
  });
  response = await handler(new Request(ACCESS_ORIGIN + "/api/v1/access/state"));
  body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.configurationIssues, undefined);
});
