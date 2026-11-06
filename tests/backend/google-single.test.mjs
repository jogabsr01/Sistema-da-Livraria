import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import {
  generateGoogleSingle,
  SINGLE_FILE,
} from "../../scripts/generate-google-single.mjs";
import { createGasEmulator } from "./gas-emulator.mjs";
import { properties } from "./fixtures.mjs";
const single = readFileSync(
  new URL("../../" + SINGLE_FILE, import.meta.url),
  "utf8",
);
test("paste-once source is current, complete and parses as one Apps Script file", () => {
  assert.equal(single, generateGoogleSingle());
  const names = readdirSync(
    new URL("../../google-apps-script", import.meta.url),
  ).filter((n) => n.endsWith(".gs"));
  for (const name of names)
    assert.equal(single.split("// BEGIN " + name + " sha256=").length, 2);
  assert.equal((single.match(/^\/\/ BEGIN /gm) || []).length, names.length);
  assert.doesNotThrow(() => new vm.Script(single));
});
test("one-file source provisions DEV, private controls and owner/catalog with retry preservation", () => {
  const gas = createGasEmulator(properties, { sourceMode: "single" });
  const original = gas.call("provisionDevelopment");
  assert.equal(gas.call("inspectDevelopmentSchema").tables, 17);
  assert.equal(gas.call("provisionDevelopmentAuthControls").version, 3);
  gas.call("prepareDevelopmentOwnerAccess");
  gas.call("provisionDevelopmentCatalog");
  const ids = Object.fromEntries(
    [
      "SPREADSHEET_ID",
      "DRIVE_ROOT_ID",
      "IDENTITY_CONTROL_SPREADSHEET_ID",
      "CATALOG_JOURNAL_ID",
      "IDENTITY_OWNER_USER_ID",
    ].map((k) => [k, gas.props[k]]),
  );
  assert.equal(
    gas.call("provisionDevelopment").spreadsheetId,
    original.spreadsheetId,
  );
  gas.call("provisionDevelopmentAuthControls");
  gas.call("prepareDevelopmentOwnerAccess");
  gas.call("provisionDevelopmentCatalog");
  for (const [k, v] of Object.entries(ids)) assert.equal(gas.props[k], v);
  assert.equal(gas.props.SIGNING_SECRET, properties.SIGNING_SECRET);
});
