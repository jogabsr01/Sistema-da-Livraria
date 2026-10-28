import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspaceClient,
  WORKSPACE_RPC_TIMEOUT_MS,
} from "../../backend/workspace-client.mjs";
import {
  createOwnerAccessHandler,
  ACCESS_ORIGIN,
  OWNER_ACCESS_BUDGET_MS,
} from "../../backend/owner-access.mjs";
import { ApiError } from "../../backend/errors.mjs";
import { ownerFixture } from "../helpers/owner-access-fixture.mjs";

test("RPC budget supports observed slow reads and shrinks against one monotonic access deadline without retry", async (t) => {
  const s = ownerFixture(),
    budgets = [],
    signal = new AbortController().signal;
  let clock = 0,
    calls = 0;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    budgets.push(ms);
    return signal;
  });
  const client = createWorkspaceClient(s.settings.config, {
    deadlineAt: 55_000,
    now: () => clock,
    fetchImpl: async (_url, options) => {
      calls++;
      clock += clock >= 50_000 ? 3_000 : 15_000;
      return new Response(JSON.stringify(s.gas.post(JSON.parse(options.body))));
    },
  });
  assert.equal(WORKSPACE_RPC_TIMEOUT_MS, 20_000);
  await client.ping();
  await client.ping();
  await client.ping();
  clock = 50_000;
  await client.ping();
  assert.deepEqual(budgets, [20_000, 20_000, 20_000, 5_000]);
  clock = 56_000;
  await assert.rejects(client.ping(), { code: "UPSTREAM_TIMEOUT" });
  assert.equal(calls, 4);
});
test("remaining request time is shared by POST and approved GET redirect", async (t) => {
  const s = ownerFixture(),
    budgets = [],
    signals = [],
    signal = new AbortController().signal;
  let envelope,
    calls = 0;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    budgets.push(ms);
    return signal;
  });
  const client = createWorkspaceClient(s.settings.config, {
    deadlineAt: 10_000,
    now: () => 7_000,
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      calls++;
      if (calls === 1) {
        envelope = JSON.parse(options.body);
        return new Response(null, {
          status: 303,
          headers: {
            location:
              "https://script.googleusercontent.com/macros/echo?opaque=test",
          },
        });
      }
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      return new Response(JSON.stringify(s.gas.post(envelope)));
    },
  });
  assert.equal((await client.ping()).ready, true);
  assert.deepEqual(budgets, [3_000]);
  assert.equal(signals[0], signals[1]);
  assert.equal(calls, 2);
  let clock = 0,
    lateCalls = 0;
  const late = createWorkspaceClient(s.settings.config, {
    deadlineAt: 5_000,
    now: () => clock,
    fetchImpl: async () => {
      lateCalls++;
      clock = 6_000;
      return new Response(null, {
        status: 303,
        headers: {
          location: "https://script.googleusercontent.com/macros/echo",
        },
      });
    },
  });
  await assert.rejects(late.ping(), { code: "UPSTREAM_TIMEOUT" });
  assert.equal(lateCalls, 1);
  clock = 0;
  const lateBody = createWorkspaceClient(s.settings.config, {
    deadlineAt: 5_000,
    now: () => clock,
    fetchImpl: async (_url, o) => ({
      status: 200,
      ok: true,
      text: async () => {
        clock = 6_000;
        return JSON.stringify(s.gas.post(JSON.parse(o.body)));
      },
    }),
  });
  await assert.rejects(lateBody.ping(), { code: "UPSTREAM_TIMEOUT" });
});
test("owner handler supplies a finite request-wide deadline and repeated state failure preserves the flow cookie", async () => {
  const s = ownerFixture();
  let options;
  const handler = createOwnerAccessHandler({
    loadSettings: () => s.settings,
    createClient: (_config, o) => {
      options = o;
      return {
        ...s.client,
        access: async () => {
          throw new ApiError(502, "UPSTREAM_TIMEOUT");
        },
      };
    },
  });
  const before = performance.now(),
    fresh = await handler(new Request(ACCESS_ORIGIN + "/api/v1/access/state"));
  assert.equal(OWNER_ACCESS_BUDGET_MS, 55_000);
  assert.ok(
    options.deadlineAt >= before + 55_000 &&
      options.deadlineAt <= performance.now() + 55_000,
  );
  const cookie = fresh.headers.get("set-cookie").split(";")[0];
  assert.equal((await fresh.json()).data.stage, "INITIAL");
  const repeated = await handler(
    new Request(ACCESS_ORIGIN + "/api/v1/access/state", {
      headers: { cookie },
    }),
  );
  assert.equal(repeated.status, 502);
  assert.equal((await repeated.json()).error.code, "UPSTREAM_TIMEOUT");
  assert.equal(repeated.headers.get("set-cookie"), null);
  assert.equal(s.main.getSheetByName("Sessoes").getLastRow(), 1);
});
