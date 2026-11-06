import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  catalogFixture,
  injectCatalogFault,
} from "../helpers/catalog-fixture.mjs";
import { keyFixture } from "../helpers/key-management-fixture.mjs";
import { emergencyFixture } from "../helpers/emergency-fixture.mjs";
const key = () => randomBytes(32).toString("hex");
function enable(s) {
  s.gas.props.MAINTENANCE_BACKUP_KEY = key();
  s.gas.call("beginDevelopmentMaintenance");
  return s;
}
const backup = (s) => s.gas.call("backupDevelopmentInstallation", randomUUID());
const read = (s, id) => s.gas.call("maintenanceRead_", id);

test("maintenance requires active Google owner, DEV, private folder, independent key and mode; RPC is frozen", async () => {
  const s = catalogFixture();
  assert.throws(() => backup(s), /MAINTENANCE_REQUIRED/);
  s.gas.props.MAINTENANCE_BACKUP_KEY = s.gas.props.SIGNING_SECRET;
  assert.throws(
    () => s.gas.call("beginDevelopmentMaintenance"),
    /MAINTENANCE_CONFIGURATION/,
  );
  enable(s);
  s.gas.activeOwner = "attacker@example.invalid";
  assert.throws(() => backup(s), /FORBIDDEN/);
  s.gas.activeOwner = "";
  assert.throws(() => backup(s), /FORBIDDEN/);
  s.gas.activeOwner = "owner@example.invalid";
  s.gas.props.APP_ENV = "prod";
  assert.throws(() => backup(s), /FORBIDDEN/);
  s.gas.props.APP_ENV = "dev";
  await assert.rejects(s.client.ping(), {code:'WORKSPACE_MAINTENANCE_ACTIVE'});
  const folder = s.gas.resources.get(s.gas.props.BACKUPS_FOLDER_ID);
  folder.viewers = [{ getEmail: () => "other@example.invalid" }];
  assert.throws(() => backup(s), /BINDING_MISMATCH/);
});
test("backup includes all stores, private properties and journals, excludes maintenance keys and is retry-safe", () => {
  const s = enable(catalogFixture()),
    id = randomUUID(),
    a = s.gas.call("backupDevelopmentInstallation", id),
    b = s.gas.call("backupDevelopmentInstallation", id);
  assert.equal(a.backupId, b.backupId);
  const body = read(s, a.backupId);
  assert.equal(body.sheets.length, 3);
  assert.ok(body.properties.SIGNING_SECRET);
  assert.equal(body.properties.MAINTENANCE_BACKUP_KEY, undefined);
  assert.equal(
    s.main.getSheetByName("Logs_Auditoria").rows.filter((r) => r[0] === id)
      .length,
    1,
  );
  assert.ok(!JSON.stringify(a).includes(s.gas.props.SIGNING_SECRET));
});
test("backup tampering, wrong installation, unmarked or shared archives fail closed", () => {
  const s = enable(catalogFixture()),
    saved = backup(s),
    f = s.gas.resources.get(saved.backupId);
  const bytes = Buffer.from(f.bytes);
  f.bytes = Buffer.from(
    f.bytes.toString().replace('"kind":"BACKUP"', '"kind":"OTHER"'),
  );
  assert.throws(() => read(s, saved.backupId), /MAINTENANCE_INVALID/);
  f.bytes = bytes;
  f.sharing = "public";
  assert.throws(() => read(s, saved.backupId), /BINDING_MISMATCH/);
  f.sharing = "private";
  s.gas.props.INSTALLATION_ID = randomUUID();
  assert.throws(
    () => read(s, saved.backupId),
    /BINDING_MISMATCH|MAINTENANCE_INVALID/,
  );
});
test("restore recreates isolated cells and immutable assets without changing live business bindings", () => {
  const s = enable(catalogFixture()),
    file = s.gas.resources
      .get(s.gas.props.COVERS_FOLDER_ID)
      .createFile(
        s.gas.context.Utilities.newBlob(
          [255, 216, 0, 255],
          "image/jpeg",
          "test.jpg",
        ),
      );
  file.setDescription("private-test");
  const saved = backup(s),
    before = s.gas.props.SPREADSHEET_ID,
    products = JSON.stringify(s.main.getSheetByName("Produtos").rows),
    id = randomUUID(),
    restored = s.gas.call("restoreDevelopmentCopy", saved.backupId, id);
  assert.equal(restored.isolated, true);
  assert.equal(restored.recovered, true);
  assert.equal(s.gas.props.SPREADSHEET_ID, before);
  assert.equal(
    JSON.stringify(s.main.getSheetByName("Produtos").rows),
    products,
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(s.gas.call("restoreDevelopmentCopy", saved.backupId, id)),
    ),
    JSON.parse(JSON.stringify(restored)),
  );
  assert.equal(s.gas.context.MAINTENANCE_CONTEXT_, null);
});
test("isolated restore resumes a product intent once while preserving failed source intent and live stock", async () => {
  const s = catalogFixture(),
    admin = s.session("SUPER_ADMIN"),
    p = s.command();
  injectCatalogFault(s, "product");
  await assert.rejects(s.client.catalog("save", admin.actor, p));
  enable(s);
  const before = JSON.stringify(s.journal.rows),
    saved = backup(s);
  assert.equal(
    s.gas.call("restoreDevelopmentCopy", saved.backupId, randomUUID())
      .recovered,
    true,
  );
  assert.equal(JSON.stringify(s.journal.rows), before);
  assert.equal(s.main.getSheetByName("Produtos").getLastRow(), 1);
  assert.equal(s.gas.context.MAINTENANCE_CONTEXT_, null);
});
test("reconciliation resumes authoritative journal and idempotent second run does not duplicate product or audit", async () => {
  const s = catalogFixture(),
    admin = s.session("SUPER_ADMIN"),
    p = s.command();
  injectCatalogFault(s, "product");
  await assert.rejects(s.client.catalog("save", admin.actor, p));
  enable(s);
  const id = randomUUID();
  assert.equal(
    s.gas.call("reconcileDevelopmentInstallation", id).reconciled,
    true,
  );
  s.gas.call("reconcileDevelopmentInstallation", id);
  assert.equal(s.main.getSheetByName("Produtos").getLastRow(), 2);
  assert.equal(
    s.main
      .getSheetByName("Logs_Auditoria")
      .rows.filter((r) => r[0] === p.commandId).length,
    1,
  );
  assert.equal(s.gas.call("endDevelopmentMaintenance").maintenance, false);
});
test("rotation refuses unresolved identity pointer and live ceremonies without changing signing key", async () => {
  const s = keyFixture();
  s.seedKey();
  await s.keyStart();
  enable(s);
  const old = s.gas.props.SIGNING_SECRET;
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = key();
  assert.throws(
    () => s.gas.call("rotateDevelopmentSigningKey", randomUUID()),
    /MAINTENANCE_PENDING/,
  );
  assert.equal(s.gas.props.SIGNING_SECRET, old);
  s.gas.props.IDENTITY_EMAIL_PENDING = randomUUID();
  assert.throws(
    () => s.gas.call("rotateDevelopmentSigningKey", randomUUID()),
    /MAINTENANCE_PENDING/,
  );
  assert.ok(s.gas.props.IDENTITY_EMAIL_PENDING);
});
test("rotation preserves recovery kit and closed flow MACs, keeps old key only in private archive, retries without another backup", async () => {
  const s = await emergencyFixture();
  await s.issueCodes();
  enable(s);
  const before = s.gas.call(
      "emergencyKit_",
      s.gas.call("baseSettings_"),
      s.userId,
    ),
    id = randomUUID(),
    next = key();
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = next;
  const out = s.gas.call("rotateDevelopmentSigningKey", id);
  assert.equal(s.gas.props.SIGNING_SECRET, next);
  assert.equal(s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET, undefined);
  const after = s.gas.call(
    "emergencyKit_",
    s.gas.call("baseSettings_"),
    s.userId,
  );
  assert.equal(JSON.stringify(after.entries), JSON.stringify(before.entries));
  assert.notEqual(after.hash, before.hash);
  assert.equal(
    s.gas.call("keyFlowRead_", s.gas.call("baseSettings_"), s.userId).state,
    "COMPLETE",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(s.gas.call("rotateDevelopmentSigningKey", id))),
    JSON.parse(JSON.stringify(out)),
  );
  assert.ok(!JSON.stringify(out).includes(next));
});
test("rotation recovers partial property writes from an independent signed intent", () => {
  const s = enable(keyFixture()),
    next = key(),
    id = randomUUID();
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = next;
  const service = s.gas.context.PropertiesService.getScriptProperties;
  let once = true;
  s.gas.context.PropertiesService.getScriptProperties = () => {
    const p = service();
    return {
      ...p,
      setProperty(k, v) {
        if (k === "SIGNING_SECRET" && once) {
          once = false;
          throw Error("INJECTED_ROTATION");
        }
        p.setProperty(k, v);
      },
    };
  };
  assert.throws(
    () => s.gas.call("rotateDevelopmentSigningKey", id),
    /INJECTED_ROTATION/,
  );
  assert.ok(s.gas.props.MAINTENANCE_ROTATION_PENDING);
  s.gas.context.PropertiesService.getScriptProperties = service;
  assert.equal(s.gas.call("rotateDevelopmentSigningKey", id).rotated, true);
  assert.equal(s.gas.props.SIGNING_SECRET, next);
});
test("technical compaction archives first, retains live sessions and business/audit history, and is idempotent", () => {
  const s = enable(catalogFixture()),
    sheet = s.main.getSheetByName("Sessoes"),
    cols = sheet.rows[0],
    old = new Date(Date.now() - 120 * 86400000).toISOString(),
    now = new Date().toISOString();
  sheet.appendRow(
    cols.map(
      (k) =>
        ({
          ID_Sessao: randomUUID(),
          ID_Usuario: randomUUID(),
          Token_Hash: key(),
          Criado_Em: old,
          Expira_Em: old,
        })[k] ?? "",
    ),
  );
  sheet.appendRow(
    cols.map(
      (k) =>
        ({
          ID_Sessao: randomUUID(),
          ID_Usuario: randomUUID(),
          Token_Hash: key(),
          Criado_Em: now,
          Expira_Em: new Date(Date.now() + 86400000).toISOString(),
        })[k] ?? "",
    ),
  );
  const id = randomUUID(),
    cutoff = new Date(Date.now() - 90 * 86400000).toISOString(),
    out = s.gas.call("compactDevelopmentTechnicalRecords", id, cutoff);
  assert.equal(out.compacted, 1);
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(
    read(s, out.backupId)
      .sheets.find((x) => x.kind === "spreadsheet")
      .tables.find((t) => t.name === "Sessoes").rows.length,
    3,
  );
  assert.equal(
    s.gas.call("compactDevelopmentTechnicalRecords", id, cutoff).compacted,
    1,
  );
  assert.equal(
    s.main.getSheetByName("Logs_Auditoria").rows.filter((r) => r[0] === id)
      .length,
    1,
  );
  assert.throws(
    () => s.gas.call("compactDevelopmentTechnicalRecords", randomUUID(), now),
    /MAINTENANCE_INVALID/,
  );
});
test("owner recovery requires privileged Google identity and approved case, revokes all factors and cannot change role/ID", () => {
  const s = keyFixture();
  s.seedKey();
  enable(s);
  const original = s.gas.props.IDENTITY_OWNER_USER_ID;
  s.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY =
    s.env.WORKSPACE_PERSONAL_INDEX_KEY;
  const id = randomUUID(),
    before = s.gas.call("accessOwner_", s.gas.call("baseSettings_")).version;
  assert.throws(
    () =>
      s.gas.call(
        "recoverDevelopmentOwnerAccess",
        id,
        "new@example.invalid",
        "anything",
      ),
    /MAINTENANCE_INVALID/,
  );
  const out = s.gas.call(
    "recoverDevelopmentOwnerAccess",
    id,
    "new@example.invalid",
    "CASE-ABCDEFGH",
  );
  assert.equal(out.reenrollmentRequired, true);
  assert.equal(s.gas.props.IDENTITY_OWNER_USER_ID, original);
  const owner = s.gas.call("accessOwner_", s.gas.call("baseSettings_"));
  assert.equal(owner.version, before + 1);
  assert.equal(owner.row.Perfil, "SUPER_ADMIN");
  assert.equal(owner.row.Primeiro_Acesso_Concluido, false);
  assert.equal(s.gas.props.IDENTITY_OWNER_LOGIN_EMAIL, "new@example.invalid");
  assert.ok(
    s.priv
      .getSheetByName("_Passkeys")
      .rows.slice(1)
      .every(
        (r) =>
          r[s.priv.getSheetByName("_Passkeys").rows[0].indexOf("Revoked_At")],
      ),
  );
  assert.equal(
    s.gas.call(
      "recoverDevelopmentOwnerAccess",
      id,
      "new@example.invalid",
      "CASE-ABCDEFGH",
    ).backupId,
    out.backupId,
  );
  assert.equal(
    s.gas.call("accessOwner_", s.gas.call("baseSettings_")).version,
    before + 1,
  );
  assert.throws(
    () =>
      s.gas.call(
        "recoverDevelopmentOwnerAccess",
        id,
        "other@example.invalid",
        "CASE-ABCDEFGH",
      ),
    /MAINTENANCE_CONFLICT/,
  );
});

test("administrative notifications expose only generic maintenance status to administrators and individual read state", async () => {
  const s = catalogFixture(),
    admin = s.session("SUPER_ADMIN"),
    staff = s.session("ATENDENTE");
  s.gas.props.NOTIFICATIONS_ENABLED = "true";
  enable(s);
  const id = randomUUID();
  s.gas.call("backupDevelopmentInstallation", id);
  s.gas.call("endDevelopmentMaintenance");
  const a = await s.client.notifications("list", admin.actor, {
      offset: 0,
      history: false,
    }),
    b = await s.client.notifications("list", staff.actor, {
      offset: 0,
      history: false,
    });
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].type, "MAINTENANCE_COMPLETED");
  assert.equal(b.items.length, 0);
  assert.ok(!JSON.stringify(a).includes(s.gas.props.SIGNING_SECRET));
  assert.ok(!JSON.stringify(a).includes("backupId"));
  await assert.rejects(
    s.client.notifications("read", staff.actor, { id }),
    /NOTIFICATION_NOT_FOUND/,
  );
  await s.client.notifications("read", admin.actor, { id });
  assert.equal(
    (await s.client.notifications("summary", admin.actor, {})).total,
    0,
  );
  assert.equal(
    (
      await s.client.notifications("list", admin.actor, {
        offset: 0,
        history: true,
      })
    ).items[0].read,
    true,
  );
});
test("recovery failure after epoch change blocks exiting maintenance and resumes once with same case", () => {
  const s = enable(keyFixture()),
    id = randomUUID(),
    save = s.gas.context.accessSaveMain_;
  s.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY =
    s.env.WORKSPACE_PERSONAL_INDEX_KEY;
  let once = true;
  s.gas.context.accessSaveMain_ = (t, r) => {
    if (
      once &&
      t.sheet.name === "Usuarios" &&
      r.Primeiro_Acesso_Concluido === false
    ) {
      once = false;
      throw Error("INJECTED_RECOVERY");
    }
    return save(t, r);
  };
  assert.throws(
    () =>
      s.gas.call(
        "recoverDevelopmentOwnerAccess",
        id,
        "new@example.invalid",
        "CASE-ABCDEFGH",
      ),
    /INJECTED_RECOVERY/,
  );
  assert.throws(
    () => s.gas.call("endDevelopmentMaintenance"),
    /MAINTENANCE_PENDING/,
  );
  s.gas.context.accessSaveMain_ = save;
  assert.equal(
    s.gas.call(
      "recoverDevelopmentOwnerAccess",
      id,
      "new@example.invalid",
      "CASE-ABCDEFGH",
    ).reenrollmentRequired,
    true,
  );
  assert.equal(
    s.main.getSheetByName("Logs_Auditoria").rows.filter((r) => r[0] === id)
      .length,
    1,
  );
});
test("recovery rejects a mailbox already indexed for another employee without revoking the owner", () => {
  const s = enable(keyFixture()),
    index = s.settings.indexKey;
  s.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY =
    s.env.WORKSPACE_PERSONAL_INDEX_KEY;
  const target = s.gas.call("accessOwner_", s.gas.call("baseSettings_")),
    users = s.main.getSheetByName("Usuarios");
  const hash = s.gas.call(
    "hex_",
    s.gas.context.Utilities.computeHmacSha256Signature(
      s.gas.context.Utilities.newBlob(
        JSON.stringify([
          "index.v1",
          "dev",
          s.gas.props.INSTALLATION_ID,
          "email",
          "taken@example.invalid",
        ]),
      ).getBytes(),
      [...index],
    ),
  );
  const person = randomUUID();
  users.appendRow(
    users.rows[0].map(
      (k) =>
        ({
          ID_Usuario: person,
          Perfil: "ATENDENTE",
          Status: "ATIVO",
          Primeiro_Acesso_Concluido: false,
          Nome: s.vault.seal("users", person, {
            name: "Pessoa",
            cpf: "52998224725",
            email: "taken@example.invalid",
            phone: "",
          }),
          CPF_Indice: s.vault.index("cpf", "52998224725"),
          Email_Indice: hash,
        })[k] ?? "",
    ),
  );
  assert.throws(
    () =>
      s.gas.call(
        "recoverDevelopmentOwnerAccess",
        randomUUID(),
        "taken@example.invalid",
        "CASE-ABCDEFGH",
      ),
    /MAINTENANCE_CONFLICT/,
  );
  assert.equal(
    s.gas.call("accessOwner_", s.gas.call("baseSettings_")).version,
    target.version,
  );
});
test("a previously completed rotation command cannot be reused after another rotation", () => {
  const s = enable(keyFixture()),
    a = randomUUID(),
    b = randomUUID();
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = key();
  s.gas.call("rotateDevelopmentSigningKey", a);
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = key();
  s.gas.call("rotateDevelopmentSigningKey", b);
  const active = s.gas.props.SIGNING_SECRET;
  s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = key();
  assert.throws(
    () => s.gas.call("rotateDevelopmentSigningKey", a),
    /MAINTENANCE_CONFLICT/,
  );
  assert.equal(s.gas.props.SIGNING_SECRET, active);
});

test("compaction failure after rewriting a table retains a signed plan and resumes without deleting live data", () => {
  const s = enable(catalogFixture()),
    sheet = s.main.getSheetByName("Sessoes"),
    old = new Date(Date.now() - 120 * 86400000).toISOString(),
    cols = sheet.rows[0];
  for (let i = 0; i < 2; i++)
    sheet.appendRow(
      cols.map(
        (k) =>
          ({
            ID_Sessao: randomUUID(),
            ID_Usuario: randomUUID(),
            Token_Hash: key(),
            Criado_Em: old,
            Expira_Em: old,
          })[k] ?? "",
      ),
    );
  const range = sheet.getRange.bind(sheet),
    id = randomUUID(),
    cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  let once = true;
  sheet.getRange = (...a) => {
    const r = range(...a),
      clear = r.clearContent;
    r.clearContent = () => {
      if (once) {
        once = false;
        throw Error("INJECTED_COMPACTION");
      }
      return clear();
    };
    return r;
  };
  assert.throws(
    () => s.gas.call("compactDevelopmentTechnicalRecords", id, cutoff),
    /INJECTED_COMPACTION/,
  );
  assert.ok(s.gas.props.MAINTENANCE_COMPACTION_PENDING);
  assert.throws(
    () => s.gas.call("endDevelopmentMaintenance"),
    /MAINTENANCE_PENDING/,
  );
  sheet.getRange = range;
  assert.equal(
    s.gas.call("compactDevelopmentTechnicalRecords", id, cutoff).compacted,
    2,
  );
  assert.equal(sheet.getLastRow(), 1);
});
test("restoration failure always clears isolated context and never rebinds active properties", async () => {
  const s = catalogFixture(),
    admin = s.session("SUPER_ADMIN"),
    p = s.command();
  injectCatalogFault(s, "product");
  await assert.rejects(s.client.catalog("save", admin.actor, p));
  enable(s);
  const saved = backup(s),
    original = s.gas.props.SPREADSHEET_ID,
    fn = s.gas.context.catalogProject_;
  s.gas.context.catalogProject_ = () => {
    throw Error("INJECTED_RESTORE");
  };
  assert.throws(
    () => s.gas.call("restoreDevelopmentCopy", saved.backupId, randomUUID()),
    /INJECTED_RESTORE/,
  );
  s.gas.context.catalogProject_ = fn;
  assert.equal(s.gas.context.MAINTENANCE_CONTEXT_, null);
  assert.equal(s.gas.props.SPREADSHEET_ID, original);
});
test("maintenance mutations are not exposed by the signed public dispatcher", () => {
  const s = catalogFixture(),
    c = s.gas.call("baseSettings_");
  for (const action of [
    "backupDevelopmentInstallation",
    "recoverDevelopmentOwnerAccess",
    "maintenance.rotate",
    "maintenance.restore",
  ])
    assert.throws(
      () =>
        s.gas.call(
          "processRequest_",
          { action, nonce: key(), requestId: randomUUID(), payload: {} },
          c,
        ),
      /FORBIDDEN/,
    );
});

test("isolated restore persists recovered private properties and verifies all copied cells and asset hashes", async () => {
  const s = catalogFixture(),
    admin = s.session("SUPER_ADMIN"),
    p = s.command();
  injectCatalogFault(s, "product");
  await assert.rejects(s.client.catalog("save", admin.actor, p));
  enable(s);
  const saved = backup(s),
    id = randomUUID();
  s.gas.call("restoreDevelopmentCopy", saved.backupId, id);
  assert.equal(s.gas.call("inspectDevelopmentRestore", id).verified, true);
  const restore = [...s.gas.resources.values()].find(
      (f) => f.name === "maintenance-restore-" + id + ".json",
    ),
    body = read(s, restore.id),
    copy = s.gas.sheets.get(body.aliases[s.gas.props.SPREADSHEET_ID]);
  assert.ok(body.restoredProperties.SIGNING_SECRET);
  copy.getSheetByName("Produtos").rows[1][
    copy.getSheetByName("Produtos").rows[0].indexOf("Titulo")
  ] = "alterado";
  assert.throws(
    () => s.gas.call("inspectDevelopmentRestore", id),
    /MAINTENANCE_CONFLICT/,
  );
  assert.equal(s.gas.context.MAINTENANCE_CONTEXT_, null);
});
test("maintenance refuses to resume normal traffic with schema damage or a committing private flow", () => {
  const s = enable(keyFixture()),
    main = s.main.getSheetByName("Produtos"),
    saved = main.rows[0][0];
  main.rows[0][0] = "invalid";
  assert.throws(
    () => s.gas.call("endDevelopmentMaintenance"),
    /SCHEMA_CONFLICT/,
  );
  main.rows[0][0] = saved;
  const flow = s.priv.getSheetByName("_Identity_Flows"),
    row = Array(flow.rows[0].length).fill("");
  row[flow.rows[0].indexOf("ID")] = randomUUID();
  row[flow.rows[0].indexOf("State")] = "COMMITTING";
  flow.appendRow(row);
  assert.throws(
    () => s.gas.call("endDevelopmentMaintenance"),
    /IDENTITY_UNAVAILABLE|MAINTENANCE_PENDING/,
  );
  assert.equal(s.gas.props.MAINTENANCE_MODE, "true");
});

test("administrative re-enrollment can deliver the first new code immediately but repeat delivery in the same epoch stays throttled", async () => {
  const s = await emergencyFixture();
  enable(s);
  s.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY = key();
  s.gas.call(
    "recoverDevelopmentOwnerAccess",
    randomUUID(),
    "new@example.invalid",
    "CASE-ABCDEFGH",
  );
  s.gas.call("endDevelopmentMaintenance");
  const before = s.gas.outbox.length,
    command = () => ({
      email: "new@example.invalid",
      flowId: randomUUID(),
      tokenHash: key(),
      codeHash: key(),
      code: randomBytes(32).toString("base64url"),
    });
  await s.client.access("start", command());
  assert.equal(s.gas.outbox.length, before + 1);
  assert.equal(s.gas.outbox.at(-1).to, "new@example.invalid");
  await s.client.access("start", command());
  assert.equal(s.gas.outbox.length, before + 1);
});

test("completed rotation and owner recovery clear their own durable marker after an interrupted final acknowledgement", () => {
  for (const recovery of [false, true]) {
    const s = enable(keyFixture()),
      id = randomUUID(),
      prop = recovery
        ? "MAINTENANCE_RECOVERY_PENDING"
        : "MAINTENANCE_ROTATION_PENDING";
    s.gas.props.MAINTENANCE_NEXT_SIGNING_SECRET = key();
    s.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY =
      s.env.WORKSPACE_PERSONAL_INDEX_KEY;
    const service = s.gas.context.PropertiesService.getScriptProperties;
    let once = true;
    s.gas.context.PropertiesService.getScriptProperties = () => {
      const p = service();
      return {
        ...p,
        setProperty(k, v) {
          if (k === prop && v === "" && once) {
            once = false;
            throw Error("INJECTED_FINAL_MARKER");
          }
          p.setProperty(k, v);
        },
      };
    };
    const run = () =>
      recovery
        ? s.gas.call(
            "recoverDevelopmentOwnerAccess",
            id,
            "new@example.invalid",
            "CASE-ABCDEFGH",
          )
        : s.gas.call("rotateDevelopmentSigningKey", id);
    assert.throws(run, /INJECTED_FINAL_MARKER/);
    assert.ok(s.gas.props[prop]);
    s.gas.context.PropertiesService.getScriptProperties = service;
    run();
    assert.equal(s.gas.props[prop], "");
    assert.equal(s.gas.call("endDevelopmentMaintenance").maintenance, false);
    assert.equal(
      s.main.getSheetByName("Logs_Auditoria").rows.filter((r) => r[0] === id)
        .length,
      1,
    );
  }
});

test("scheduled backup is opt-in, validates the installed trigger, retries once per interval and does not unfreeze manual maintenance", () => {
  const s = enable(catalogFixture());
  s.gas.call("endDevelopmentMaintenance");
  assert.throws(() => s.gas.call("runDevelopmentBackupJob", {}), /FORBIDDEN/);
  assert.equal(
    s.gas.call("installDevelopmentBackupSchedule", 24).scheduled,
    true,
  );
  s.gas.call("installDevelopmentBackupSchedule", 24);
  const p = JSON.parse(s.gas.props.MAINTENANCE_BACKUP_SCHEDULE);
  s.gas.activeOwner = "";
  const a = s.gas.call("runDevelopmentBackupJob", { triggerUid: p.id });
  assert.equal(a.backedUp, true);
  const files = s.gas.resources.size;
  s.gas.call("runDevelopmentBackupJob", { triggerUid: p.id });
  assert.equal(s.gas.resources.size, files);
  assert.throws(
    () => s.gas.call("runDevelopmentBackupJob", { triggerUid: "wrong" }),
    /FORBIDDEN/,
  );
  s.gas.activeOwner = "owner@example.invalid";
  s.gas.call("beginDevelopmentMaintenance");
  assert.equal(
    s.gas.call("runDevelopmentBackupJob", { triggerUid: p.id }).skipped,
    true,
  );
  assert.equal(s.gas.props.MAINTENANCE_MODE, "true");
});
test("only the Google owner installs/removes schedules and removal leaves unrelated triggers untouched", () => {
  const s = enable(catalogFixture());
  assert.throws(
    () => s.gas.call("installDevelopmentBackupSchedule", 3),
    /MAINTENANCE_INVALID/,
  );
  s.gas.activeOwner = "operator@example.invalid";
  assert.throws(
    () => s.gas.call("installDevelopmentBackupSchedule", 24),
    /FORBIDDEN/,
  );
  s.gas.activeOwner = "owner@example.invalid";
  s.gas.call("installDevelopmentBackupSchedule", 24);
  s.gas.context.ScriptApp.newTrigger("unrelated")
    .timeBased()
    .everyHours(1)
    .create();
  s.gas.call("removeDevelopmentBackupSchedule");
  assert.equal(s.gas.context.ScriptApp.getProjectTriggers().length, 1);
  const p = JSON.parse(s.gas.props.MAINTENANCE_BACKUP_SCHEDULE);
  assert.throws(
    () => s.gas.call("runDevelopmentBackupJob", { triggerUid: p.id }),
    /FORBIDDEN/,
  );
});
