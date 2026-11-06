import test from "node:test";
import assert from "node:assert/strict";
import { createGasEmulator } from "./gas-emulator.mjs";
import { properties } from "./fixtures.mjs";
function fixture() {
  const gas = createGasEmulator(properties),
    installation = gas.call("provisionDevelopment");
  gas.call("provisionDevelopmentAuthControls");
  return { gas, ss: gas.sheets.get(installation.spreadsheetId) };
}
function countReads(ss) {
  const counts = new Map();
  for (const sheet of ss.getSheets()) {
    const original = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = original(...args),
        read = range.getValues;
      range.getValues = () => {
        const key = sheet.getName() + ":" + args[0];
        counts.set(key, (counts.get(key) || 0) + 1);
        return read();
      };
      return range;
    };
  }
  return counts;
}
test("schema validation reads all headers once and migration history once without caching later changes", () => {
  const { gas, ss } = fixture(),
    counts = countReads(ss);
  gas.call("assertSchema_", ss);
  for (const sheet of ss.getSheets())
    assert.equal(counts.get(sheet.getName() + ":1"), 1);
  assert.equal(counts.get("_Migracoes:2"), 1);
  const products = ss.getSheetByName("Produtos");
  products.rows[0][0] = "changed";
  const writes = gas.writes;
  assert.throws(() => gas.call("assertSchema_", ss), /SCHEMA_CONFLICT/);
  assert.equal(gas.writes, writes);
});
test("schema validation preserves conflict precedence and refuses missing, empty or invalid migration evidence", () => {
  for (const mode of [
    "missing",
    "empty",
    "conflict-over-missing",
    "duplicate",
    "hash",
  ]) {
    const { gas, ss } = fixture();
    let expected = "SCHEMA_REQUIRED";
    if (mode === "missing" || mode === "conflict-over-missing")
      ss.tables.delete("Usuarios");
    if (mode === "empty") ss.getSheetByName("Produtos").rows = [];
    if (mode === "conflict-over-missing") {
      ss.getSheetByName("Produtos").rows[0][0] = "bad";
      expected = "SCHEMA_CONFLICT";
    }
    if (mode === "duplicate") {
      ss.getSheetByName("_Migracoes").appendRow([
        ...ss.getSheetByName("_Migracoes").rows[1],
      ]);
      expected = "SCHEMA_INVALID";
    }
    if (mode === "hash") ss.getSheetByName("_Migracoes").rows[1][3] = "bad";
    const writes = gas.writes;
    assert.throws(() => gas.call("assertSchema_", ss), new RegExp(expected));
    assert.equal(gas.writes, writes);
  }
});
test("private control validation checks every header and capacity without reading unused table bodies", () => {
  const { gas } = fixture(),
    ss = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID);
  for (const sheet of ss.getSheets())
    if (sheet.getName() !== "_Control_Migrations")
      sheet.appendRow(
        new Array(sheet.rows[0].length).fill("unused-test-value"),
      );
  const counts = countReads(ss);
  gas.call("authControlStore_", gas.call("baseSettings_"));
  for (const sheet of ss.getSheets())
    assert.equal(counts.get(sheet.getName() + ":1"), 1);
  assert.equal(counts.get("_Control_Migrations:2"), 1);
  for (const sheet of ss.getSheets())
    if (sheet.getName() !== "_Control_Migrations")
      assert.equal(counts.has(sheet.getName() + ":2"), false);
  ss.getSheetByName("_Identity_Flows").rows[0][0] = "changed";
  assert.throws(
    () => gas.call("authControlStore_", gas.call("baseSettings_")),
    /IDENTITY_UNAVAILABLE/,
  );
  const flows = ss.getSheetByName("_Identity_Flows");
  flows.rows = Array.from({ length: 3002 }, (_, i) =>
    i === 0 ? ["_ID", ...flows.rows[0].slice(1)] : ["capacity"],
  );
  flows.rows[0][0] = "ID";
  assert.throws(
    () => gas.call("authControlStore_", gas.call("baseSettings_")),
    /IDENTITY_UNAVAILABLE/,
  );
});
