/* Privileged DEV maintenance. No function in this file is routed by doPost.
 * Recovery uses an isolated resource map under ScriptLock; active bindings stay intact. */
var MAINTENANCE_CONTEXT_ = null;
function scriptProperties_() {
  return MAINTENANCE_CONTEXT_
    ? MAINTENANCE_CONTEXT_.properties
    : PropertiesService.getScriptProperties();
}
function maintenanceId_(id) {
  return (MAINTENANCE_CONTEXT_ && MAINTENANCE_CONTEXT_.aliases[id]) || id;
}
function resourceFile_(id) {
  return DriveApp.getFileById(maintenanceId_(id));
}
function resourceFolder_(id) {
  return DriveApp.getFolderById(maintenanceId_(id));
}
function resourceSheet_(id) {
  return SpreadsheetApp.openById(maintenanceId_(id));
}
function maintenanceFail_(code) {
  failure_(code || "MAINTENANCE_INVALID");
}
function maintenanceOwner_() {
  var c = baseSettings_();
  requireOwnerDev_(c);
  var active = Session.getActiveUser().getEmail().toLowerCase();
  if (!active || active !== c.owner) maintenanceFail_("FORBIDDEN");
  return c;
}
function maintenanceKey_() {
  var p = scriptProperties_(),
    k = p.getProperty("MAINTENANCE_BACKUP_KEY");
  if (!accessHash_(k) || k === p.getProperty("SIGNING_SECRET"))
    maintenanceFail_("MAINTENANCE_CONFIGURATION");
  return k;
}
function maintenanceGuard_(resume) {
  var c = maintenanceOwner_();
  if (scriptProperties_().getProperty("MAINTENANCE_MODE") !== "true")
    maintenanceFail_("MAINTENANCE_REQUIRED");
  maintenanceKey_();
  if (
    !resume &&
    Object.keys(scriptProperties_().getProperties()).some(function (k) {
      return (
        /^MAINTENANCE_.*_PENDING$/.test(k) && scriptProperties_().getProperty(k)
      );
    })
  )
    maintenanceFail_("MAINTENANCE_PENDING");
  return c;
}
function maintenanceAcl_(folder) {
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE)
    maintenanceFail_("BINDING_MISMATCH");
  var allowed = [
    baseSettings_().owner,
    scriptProperties_().getProperty("MAINTENANCE_RECOVERY_EMAIL"),
  ].filter(Boolean);
  if (
    folder
      .getEditors()
      .concat(folder.getViewers())
      .some(function (u) {
        return !allowed.includes(u.getEmail().toLowerCase());
      })
  )
    maintenanceFail_("BINDING_MISMATCH");
}
function maintenanceFolder_(c) {
  var folder = storage_(c, true).backup;
  maintenanceAcl_(folder);
  return folder;
}
function maintenanceSign_(body) {
  return hmac_(JSON.stringify(body), maintenanceKey_(), "maintenance.archive");
}
function maintenanceWrite_(folder, name, body) {
  var file = folder.createFile(
    Utilities.newBlob(
      JSON.stringify({ body: body, signature: maintenanceSign_(body) }),
      "application/json",
      name,
    ),
  );
  file.setDescription(marker_(baseSettings_(), "maintenance-archive"));
  return file;
}
function maintenanceRead_(id) {
  var c = baseSettings_(),
    folder = maintenanceFolder_(c),
    file = resourceFile_(id),
    parents = file.getParents(),
    belongs = false;
  while (parents.hasNext())
    if (parents.next().getId() === folder.getId()) belongs = true;
  if (!belongs) maintenanceFail_("BINDING_MISMATCH");
  assertMarker_(file, c, "maintenance-archive");
  if (file.getSize() > 24000000) maintenanceFail_("MAINTENANCE_CAPACITY");
  var raw;
  try {
    raw = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
  } catch (_) {
    maintenanceFail_();
  }
  if (
    !raw ||
    !constantEqual_(raw.signature, maintenanceSign_(raw.body)) ||
    raw.body.installationId !== c.installationId ||
    raw.body.environment !== "dev"
  )
    maintenanceFail_();
  return raw.body;
}
function beginDevelopmentMaintenance() {
  var c = maintenanceOwner_();
  return withLock_(function () {
    maintenanceKey_();
    storage_(c, true);
    scriptProperties_().setProperty("MAINTENANCE_MODE", "true");
    return { environment: "dev", maintenance: true };
  });
}
function maintenanceTables_(ss) {
  var sheets = ss.getSheets();
  if (sheets.length > 40) maintenanceFail_("MAINTENANCE_CAPACITY");
  return sheets
    .map(function (s) {
      var h = s.getLastRow(),
        w = s.getLastColumn();
      if (h > 5001 || w > 100) maintenanceFail_("MAINTENANCE_CAPACITY");
      var range = h && w ? s.getRange(1, 1, h, w) : null;
      if (
        range &&
        range.getFormulas &&
        range.getFormulas().some(function (r) {
          return r.some(Boolean);
        })
      )
        maintenanceFail_("MAINTENANCE_FORMULA");
      return {
        name: s.getName(),
        rows: range ? JSON.parse(JSON.stringify(range.getValues())) : [],
      };
    })
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
}
function maintenanceSnapshot_(c, id) {
  var p = scriptProperties_().getProperties(),
    properties = {};
  Object.keys(p)
    .sort()
    .forEach(function (k) {
      if (
        ![
          "MAINTENANCE_BACKUP_KEY",
          "MAINTENANCE_NEXT_SIGNING_SECRET",
          "MAINTENANCE_PERSONAL_INDEX_KEY",
        ].includes(k)
      )
        properties[k] = p[k];
    });
  var files = [
      ["SPREADSHEET_ID", "spreadsheet"],
      ["IDENTITY_CONTROL_SPREADSHEET_ID", "identity-controls"],
      ["CATALOG_JOURNAL_ID", "catalog-journal"],
    ],
    sheets = [];
  files.forEach(function (pair) {
    if (!p[pair[0]]) return;
    var f = resourceFile_(p[pair[0]]);
    assertMarker_(f, c, pair[1]);
    sheets.push({
      id: p[pair[0]],
      kind: pair[1],
      tables: maintenanceTables_(resourceSheet_(p[pair[0]])),
    });
  });
  var folders = [],
    assets = [],
    ids = new Set();
  Object.keys(p)
    .sort()
    .filter(function (k) {
      return /_FOLDER_ID$/.test(k) && k !== "BACKUPS_FOLDER_ID";
    })
    .forEach(function (k) {
      if (!p[k] || ids.has(p[k])) return;
      ids.add(p[k]);
      var f = resourceFolder_(p[k]),
        m;
      try {
        m = JSON.parse(f.getDescription());
      } catch (_) {
        maintenanceFail_("BINDING_MISMATCH");
      }
      assertMarker_(f, c, m.kind);
      folders.push({ id: p[k], kind: m.kind });
      var it = f.getFiles();
      while (it.hasNext()) {
        var a = it.next();
        if (
          assets.length >= 1000 ||
          a.getSharingAccess() !== DriveApp.Access.PRIVATE ||
          a.getSize() > 4000000
        )
          maintenanceFail_("MAINTENANCE_CAPACITY");
        var bytes = a.getBlob().getBytes();
        assets.push({
          id: a.getId(),
          folder: p[k],
          name: a.getName(),
          mime: a.getMimeType(),
          description: a.getDescription(),
          bytes: Utilities.base64Encode(bytes),
          sha256: hex_(
            Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes),
          ),
        });
      }
    });
  var body = {
    version: 1,
    kind: "BACKUP",
    environment: "dev",
    installationId: c.installationId,
    id: id,
    createdAt: new Date().toISOString(),
    properties: properties,
    sheets: sheets,
    folders: folders,
    assets: assets,
  };
  if (Utilities.newBlob(JSON.stringify(body)).getBytes().length > 22000000)
    maintenanceFail_("MAINTENANCE_CAPACITY");
  return body;
}
function maintenanceBackup_(c, id) {
  if (!identityUuid_(id)) maintenanceFail_();
  var folder = maintenanceFolder_(c),
    name = "maintenance-backup-" + id + ".json",
    it = folder.getFilesByName(name),
    files = [];
  while (it.hasNext()) files.push(it.next());
  if (files.length > 1) maintenanceFail_();
  if (files.length) {
    var prior = maintenanceRead_(files[0].getId());
    if (prior.kind !== "BACKUP" || prior.id !== id) maintenanceFail_();
    return { fileId: files[0].getId(), hash: digest_(JSON.stringify(prior)) };
  }
  var snapshot = maintenanceSnapshot_(c, id),
    file = maintenanceWrite_(folder, name, snapshot);
  return { fileId: file.getId(), hash: digest_(JSON.stringify(snapshot)) };
}
function backupDevelopmentInstallation(commandId) {
  var c = maintenanceGuard_();
  return withLock_(function () {
    var saved = maintenanceBackup_(c, commandId);
    var body = maintenanceRead_(saved.fileId);
    maintenanceLog_(commandId, body.createdAt, "MAINTENANCE_BACKUP", {
      count: body.sheets.length,
    });
    return { environment: "dev", backupId: saved.fileId, hash: saved.hash };
  });
}
function maintenanceWithCopy_(body, aliases, fn) {
  if (MAINTENANCE_CONTEXT_) maintenanceFail_();
  var values = JSON.parse(JSON.stringify(body.properties));
  MAINTENANCE_CONTEXT_ = {
    aliases: aliases,
    properties: {
      getProperties: function () {
        return JSON.parse(JSON.stringify(values));
      },
      getProperty: function (k) {
        return values[k] || null;
      },
      setProperty: function (k, v) {
        values[k] = v;
      },
      deleteProperty: function (k) {
        delete values[k];
      },
    },
  };
  try {
    return fn(baseSettings_());
  } finally {
    MAINTENANCE_CONTEXT_ = null;
  }
}
function maintenanceSettle_(c) {
  var p = scriptProperties_(),
    ss = storage_(c, false).spreadsheet;
  if (p.getProperty("IDENTITY_CONTROL_SPREADSHEET_ID")) {
    recoverEmergencyRecovery_(c);
    recoverKeyManagement_(c);
    recoverSecurityIntent_(c);
    recoverStaff_(c);
    recoverProfiles_(c);
    recoverRecoveryIntents_(c);
    recoverEmailChanges_(c);
    recoverNiches_(c);
    recoverSchedules_(c);
    accessRecoverIntents_(authControlStore_(c), c, Date.now());
  }
  if (p.getProperty("CATALOG_JOURNAL_ID")) {
    recoverCatalog_(c);
    recoverSales_(ss);
  }
}
function restoreDevelopmentCopy(backupId, commandId) {
  var c = maintenanceGuard_();
  return withLock_(function () {
    if (!identityUuid_(commandId)) maintenanceFail_();
    var body = maintenanceRead_(backupId);
    if (body.kind !== "BACKUP" || body.version !== 1) maintenanceFail_();
    var folder = maintenanceFolder_(c),
      name = "maintenance-restore-" + commandId + ".json",
      existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      var previous = maintenanceRead_(existing.next().getId());
      if (previous.source !== backupId)
        maintenanceFail_("MAINTENANCE_CONFLICT");
      maintenanceLog_(commandId, previous.createdAt, "MAINTENANCE_RESTORE", {
        count: body.sheets.length,
      });
      return {
        environment: "dev",
        restoreId: previous.id,
        isolated: true,
        recovered: previous.recovered,
      };
    }
    var root = folder.createFolder("Restore DEV " + commandId);
    root.setDescription(marker_(c, "root"));
    var aliases = {},
      cloneFolders = {};
    aliases[body.properties.DRIVE_ROOT_ID] = root.getId();
    var backups = root.createFolder("backups");
    backups.setDescription(marker_(c, "backups"));
    aliases[body.properties.BACKUPS_FOLDER_ID] = backups.getId();
    body.folders.forEach(function (f) {
      var next = root.createFolder(f.kind);
      next.setDescription(marker_(c, f.kind));
      aliases[f.id] = next.getId();
      cloneFolders[f.id] = next;
    });
    body.sheets.forEach(function (s) {
      var ss = SpreadsheetApp.create("Restore " + s.kind + " " + commandId),
        file = DriveApp.getFileById(ss.getId());
      file.setDescription(marker_(c, s.kind));
      file.moveTo(root);
      aliases[s.id] = ss.getId();
      s.tables.forEach(function (t) {
        var sheet = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
        if (t.rows.length) {
          var range = sheet.getRange(1, 1, t.rows.length, t.rows[0].length);
          range.setNumberFormat("@");
          range.setValues(t.rows);
        }
      });
      ss.getSheets()
        .filter(function (t) {
          return !s.tables.some(function (saved) {
            return saved.name === t.getName();
          });
        })
        .forEach(function (t) {
          ss.deleteSheet(t);
        });
    });
    body.assets.forEach(function (a) {
      var bytes = Utilities.base64Decode(a.bytes);
      if (
        hex_(
          Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes),
        ) !== a.sha256 ||
        !cloneFolders[a.folder]
      )
        maintenanceFail_();
      var file = cloneFolders[a.folder].createFile(
        Utilities.newBlob(bytes, a.mime, a.name),
      );
      file.setDescription(a.description);
      aliases[a.id] = file.getId();
    });
    var recovered = maintenanceWithCopy_(body, aliases, function (copy) {
      assertSchema_(storage_(copy, true).spreadsheet);
      body.sheets.forEach(function (s) {
        if (!same_(maintenanceTables_(resourceSheet_(s.id)), s.tables))
          maintenanceFail_("MAINTENANCE_CONFLICT");
      });
      maintenanceSettle_(copy);
      return {
        properties: scriptProperties_().getProperties(),
        tables: body.sheets.map(function (s) {
          return {
            id: s.id,
            hash: digest_(
              JSON.stringify(maintenanceTables_(resourceSheet_(s.id))),
            ),
          };
        }),
      };
    });
    var result = {
      version: 1,
      kind: "RESTORE",
      environment: "dev",
      installationId: c.installationId,
      id: commandId,
      source: backupId,
      aliases: aliases,
      recovered: true,
      restoredProperties: recovered.properties,
      tableHashes: recovered.tables,
      createdAt: new Date().toISOString(),
    };
    maintenanceWrite_(folder, name, result);
    maintenanceLog_(commandId, result.createdAt, "MAINTENANCE_RESTORE", {
      count: body.sheets.length,
    });
    return {
      environment: "dev",
      restoreId: commandId,
      isolated: true,
      recovered: true,
    };
  });
}
function maintenanceCommandUnused_(id) {
  if (
    identityRows_(
      storage_(baseSettings_(), false).spreadsheet,
      "Logs_Auditoria",
    ).rows.some(function (r) {
      return r.ID_Log === id;
    })
  )
    maintenanceFail_("MAINTENANCE_CONFLICT");
}
function maintenanceQuiescent_() {
  var p = scriptProperties_().getProperties();
  if (
    Object.keys(p).some(function (k) {
      return /_PENDING$/.test(k) && p[k];
    })
  )
    maintenanceFail_("MAINTENANCE_PENDING");
  var ss = storage_(baseSettings_(), false).spreadsheet;
  assertSchema_(ss);
  ss.getSheets().forEach(function (s) {
    var values = s.getLastRow()
        ? s.getRange(1, 1, s.getLastRow(), s.getLastColumn()).getValues()
        : [],
      col = values.length ? values[0].indexOf("State") : -1;
    if (
      col >= 0 &&
      values.slice(1).some(function (r) {
        return ["PENDING", "COMMITTING", "PROVING"].includes(r[col]);
      })
    )
      maintenanceFail_("MAINTENANCE_PENDING");
  });
  if (
    p.IDENTITY_CONTROL_SPREADSHEET_ID &&
    accessFlows_(authControlStore_(baseSettings_())).rows.some(function (r) {
      return r.State === "COMMITTING";
    })
  )
    maintenanceFail_("MAINTENANCE_PENDING");
  Object.keys(p)
    .filter(function (k) {
      return /^IDENTITY_KEYS_[a-f0-9-]{36}$/.test(k);
    })
    .forEach(function (k) {
      if (
        ["PROVING", "COMMITTING"].includes(
          keyFlowRead_(baseSettings_(), k.slice("IDENTITY_KEYS_".length)).state,
        )
      )
        maintenanceFail_("MAINTENANCE_PENDING");
    });
  var configs = identityRows_(ss, "Configuracoes");
  if (
    configs.rows.some(function (r) {
      if (typeof r.Valor !== "string" || r.Valor[0] !== "{") return false;
      try {
        return ["PENDING", "COMMITTING", "PROVING"].includes(
          JSON.parse(r.Valor).state,
        );
      } catch (_) {
        return false;
      }
    })
  )
    maintenanceFail_("MAINTENANCE_PENDING");
  if (
    p.CATALOG_JOURNAL_ID &&
    catalogJournal_(baseSettings_()).rows.some(function (r) {
      return r.State !== "COMPLETE";
    })
  )
    maintenanceFail_("MAINTENANCE_PENDING");
}
function reconcileDevelopmentInstallation(commandId) {
  var c = maintenanceGuard_();
  return withLock_(function () {
    var old = identityRows_(
      storage_(c, false).spreadsheet,
      "Logs_Auditoria",
    ).rows.filter(function (r) {
      return r.ID_Log === commandId;
    });
    if (old.length) {
      if (old.length !== 1 || old[0].Acao !== "MAINTENANCE_RECONCILED")
        maintenanceFail_("MAINTENANCE_CONFLICT");
      return {
        environment: "dev",
        reconciled: true,
        backupId: maintenanceBackup_(c, commandId).fileId,
      };
    }
    var backup = maintenanceBackup_(c, commandId);
    maintenanceSettle_(c);
    maintenanceQuiescent_();
    maintenanceLog_(
      commandId,
      maintenanceRead_(backup.fileId).createdAt,
      "MAINTENANCE_RECONCILED",
      { otherSessionsRevoked: false },
    );
    return { environment: "dev", reconciled: true, backupId: backup.fileId };
  });
}
function endDevelopmentMaintenance() {
  maintenanceGuard_();
  return withLock_(function () {
    maintenanceQuiescent_();
    scriptProperties_().setProperty("MAINTENANCE_MODE", "false");
    return { environment: "dev", maintenance: false };
  });
}
function maintenanceFinishMarker_(property, commandId, kind) {
  var props = scriptProperties_(),
    pointer = props.getProperty(property);
  if (!pointer) return;
  var plan = maintenanceRead_(pointer);
  if (plan.id !== commandId || plan.kind !== kind)
    maintenanceFail_("MAINTENANCE_CONFLICT");
  props.setProperty(property, "");
}
function rotateDevelopmentSigningKey(commandId) {
  var c = maintenanceGuard_(true);
  return withLock_(function () {
    var props = scriptProperties_(),
      pointer = props.getProperty("MAINTENANCE_ROTATION_PENDING"),
      plan;
    var last = props.getProperty("MAINTENANCE_LAST_ROTATION");
    if (last) {
      last = JSON.parse(last);
      if (last.id === commandId) {
        var staged = props.getProperty("MAINTENANCE_NEXT_SIGNING_SECRET");
        if (
          digest_(props.getProperty("SIGNING_SECRET")) !== last.afterHash ||
          (staged && digest_(staged) !== last.afterHash)
        )
          maintenanceFail_("MAINTENANCE_CONFLICT");
        maintenanceFinishMarker_(
          "MAINTENANCE_ROTATION_PENDING",
          commandId,
          "ROTATION",
        );
        return {
          environment: "dev",
          rotated: true,
          backupId: last.backupId,
          backendConfigurationRequired: true,
        };
      }
    }
    if (pointer) {
      plan = maintenanceRead_(pointer);
      if (plan.kind !== "ROTATION" || plan.id !== commandId)
        maintenanceFail_("MAINTENANCE_CONFLICT");
    } else {
      if (!identityUuid_(commandId)) maintenanceFail_();
      maintenanceCommandUnused_(commandId);
      maintenanceQuiescent_();
      var next = props.getProperty("MAINTENANCE_NEXT_SIGNING_SECRET");
      if (!accessHash_(next) || next === c.secret || next === maintenanceKey_())
        maintenanceFail_("MAINTENANCE_CONFIGURATION");
      var backup = maintenanceBackup_(c, commandId),
        all = props.getProperties(),
        changes = {};
      Object.keys(all)
        .sort()
        .forEach(function (k) {
          var domain, v;
          if (/^IDENTITY_KEYS_[a-f0-9-]{36}$/.test(k)) {
            v = keyFlowRead_(c, k.slice("IDENTITY_KEYS_".length));
            domain = "passkey.management";
            if (
              ["PROVING", "COMMITTING"].includes(v.state) ||
              (["AUTH", "REGISTER"].includes(v.state) &&
                Date.parse(v.expiresAt) > Date.now())
            )
              maintenanceFail_("MAINTENANCE_PENDING");
            if (["AUTH", "REGISTER"].includes(v.state)) v.state = "CANCELLED";
          } else if (/^IDENTITY_RESCUE_CODES_[a-f0-9-]{36}$/.test(k)) {
            v = emergencyKit_(c, k.slice("IDENTITY_RESCUE_CODES_".length));
            domain = "emergency.codes";
          } else return;
          var clone = JSON.parse(JSON.stringify(v));
          delete clone.hash;
          v.hash = hmac_(JSON.stringify(clone), next, domain);
          changes[k] = JSON.stringify(v);
        });
      plan = {
        version: 1,
        kind: "ROTATION",
        environment: "dev",
        installationId: c.installationId,
        id: commandId,
        backupId: backup.fileId,
        before: c.secret,
        after: next,
        changes: changes,
        createdAt: new Date().toISOString(),
      };
      var f = maintenanceWrite_(
        maintenanceFolder_(c),
        "maintenance-rotation-" + commandId + ".json",
        plan,
      );
      props.setProperty("MAINTENANCE_ROTATION_PENDING", f.getId());
    }
    if (
      ![plan.before, plan.after].includes(props.getProperty("SIGNING_SECRET"))
    )
      maintenanceFail_("MAINTENANCE_CONFLICT");
    Object.keys(plan.changes).forEach(function (k) {
      props.setProperty(k, plan.changes[k]);
    });
    props.setProperty("SIGNING_SECRET", plan.after);
    props.deleteProperty("MAINTENANCE_NEXT_SIGNING_SECRET");
    maintenanceLog_(commandId, plan.createdAt, "MAINTENANCE_KEY_ROTATED", {
      count: Object.keys(plan.changes).length,
    });
    props.setProperty(
      "MAINTENANCE_LAST_ROTATION",
      JSON.stringify({
        id: commandId,
        at: plan.createdAt,
        backupId: plan.backupId,
        afterHash: digest_(plan.after),
      }),
    );
    props.setProperty("MAINTENANCE_ROTATION_PENDING", "");
    return {
      environment: "dev",
      rotated: true,
      backupId: plan.backupId,
      backendConfigurationRequired: true,
    };
  });
}
/* Only expired technical records are compacted. Business/audit/journal rows stay intact. */
function compactDevelopmentTechnicalRecords(commandId, cutoff) {
  var c = maintenanceGuard_(true);
  return withLock_(function () {
    var props = scriptProperties_(),
      pointer = props.getProperty("MAINTENANCE_COMPACTION_PENDING"),
      plan;
    if (pointer) {
      plan = maintenanceRead_(pointer);
      if (
        plan.kind !== "COMPACTION" ||
        plan.id !== commandId ||
        plan.cutoff !== cutoff
      )
        maintenanceFail_("MAINTENANCE_CONFLICT");
    } else {
      if (
        !identityUuid_(commandId) ||
        typeof cutoff !== "string" ||
        !Number.isFinite(Date.parse(cutoff)) ||
        new Date(cutoff).toISOString() !== cutoff ||
        Date.parse(cutoff) > Date.now() - 30 * 86400000
      )
        maintenanceFail_();
      var last = props.getProperty("MAINTENANCE_LAST_COMPACTION");
      if (last) {
        last = JSON.parse(last);
        if (last.id === commandId) {
          if (last.cutoff !== cutoff) maintenanceFail_("MAINTENANCE_CONFLICT");
          return {
            environment: "dev",
            compacted: last.removed,
            backupId: last.backupId,
          };
        }
      }
      maintenanceCommandUnused_(commandId);
      maintenanceQuiescent_();
      var backup = maintenanceBackup_(c, commandId),
        changes = [],
        removed = 0;
      var sources = [
        { id: c.spreadsheetId, name: "Sessoes", time: "Expira_Em" },
        { id: c.spreadsheetId, name: "_Requisicoes", time: null },
      ];
      var priv = props.getProperty("IDENTITY_CONTROL_SPREADSHEET_ID");
      if (priv) {
        sources.push({
          id: priv,
          name: "_Auth_Challenges",
          time: "Expires_At",
        });
        sources.push({ id: priv, name: "_Identity_Flows", time: "Expires_At" });
      }
      var pinned = new Set(),
        all = props.getProperties();
      Object.keys(all)
        .filter(function (k) {
          return /^IDENTITY_RESCUE_CODES_[a-f0-9-]{36}$/.test(k);
        })
        .forEach(function (k) {
          emergencyKit_(
            c,
            k.slice("IDENTITY_RESCUE_CODES_".length),
          ).entries.forEach(function (e) {
            if (e.flowId) pinned.add(e.flowId);
          });
        });
      sources.forEach(function (source) {
        var sheet = resourceSheet_(source.id).getSheetByName(source.name);
        if (!sheet) return;
        var values = maintenanceTables_(resourceSheet_(source.id)).filter(
          function (t) {
            return t.name === source.name;
          },
        )[0].rows;
        if (!values.length) return;
        var cols = values[0],
          index = source.time ? cols.indexOf(source.time) : 2,
          id = cols.indexOf("ID"),
          state = cols.indexOf("State");
        if (index < 0) maintenanceFail_();
        var keep = values.slice(1).filter(function (row) {
          var at = row[index];
          if (typeof at !== "string" || !Number.isFinite(Date.parse(at)))
            maintenanceFail_();
          if (
            Date.parse(at) >= Date.parse(cutoff) ||
            (id >= 0 && pinned.has(row[id])) ||
            (state >= 0 && ["COMMITTING", "PROVING"].includes(row[state]))
          )
            return true;
          return false;
        });
        removed += values.length - 1 - keep.length;
        if (keep.length !== values.length - 1)
          changes.push({
            resource: source.id,
            table: source.name,
            columns: cols,
            before: values.length,
            after: [cols].concat(keep),
          });
      });
      plan = {
        version: 1,
        kind: "COMPACTION",
        environment: "dev",
        installationId: c.installationId,
        id: commandId,
        cutoff: cutoff,
        backupId: backup.fileId,
        removed: removed,
        changes: changes,
        createdAt: new Date().toISOString(),
      };
      var file = maintenanceWrite_(
        maintenanceFolder_(c),
        "maintenance-compaction-" + commandId + ".json",
        plan,
      );
      props.setProperty("MAINTENANCE_COMPACTION_PENDING", file.getId());
    }
    plan.changes.forEach(function (change) {
      var sheet = resourceSheet_(change.resource).getSheetByName(change.table);
      if (!same_(rowValues_(sheet), change.columns))
        maintenanceFail_("MAINTENANCE_CONFLICT");
      var range = sheet.getRange(
        1,
        1,
        change.after.length,
        change.columns.length,
      );
      range.setNumberFormat("@");
      range.setValues(change.after);
      if (change.before > change.after.length)
        sheet
          .getRange(
            change.after.length + 1,
            1,
            change.before - change.after.length,
            change.columns.length,
          )
          .clearContent();
      SpreadsheetApp.flush();
    });
    maintenanceLog_(commandId, plan.createdAt, "MAINTENANCE_COMPACTED", {
      count: plan.removed,
    });
    props.setProperty(
      "MAINTENANCE_LAST_COMPACTION",
      JSON.stringify({
        id: commandId,
        cutoff: cutoff,
        removed: plan.removed,
        backupId: plan.backupId,
      }),
    );
    props.setProperty("MAINTENANCE_COMPACTION_PENDING", "");
    return {
      environment: "dev",
      compacted: plan.removed,
      backupId: plan.backupId,
    };
  });
}
function maintenanceLog_(id, at, action, detail) {
  var ss = storage_(baseSettings_(), false).spreadsheet;
  securityAppend_(
    ss,
    securityLog_(id, at, "SYSTEM_AUTH", "SYSTEM", action, detail),
  );
  var titles = {
      MAINTENANCE_BACKUP: "Cópia de segurança criada",
      MAINTENANCE_RESTORE: "Restauração isolada verificada",
      MAINTENANCE_RECONCILED: "Sincronização e diários conferidos",
      MAINTENANCE_KEY_ROTATED: "Chave de assinatura atualizada",
      MAINTENANCE_COMPACTED: "Registros técnicos arquivados",
      IDENTITY_ADMIN_RECOVERY: "Recuperação administrativa preparada",
    },
    table = notificationRows_(ss),
    prior = table.rows.filter(function (r) {
      return r.ID_Notificacao === id;
    }),
    row = {
      ID_Notificacao: id,
      Tipo: "MAINTENANCE_COMPLETED",
      Prioridade: "MEDIA",
      Titulo: titles[action] || "Manutenção administrativa concluída",
      Mensagem:
        "Procedimento administrativo registrado. Consulte a auditoria autorizada para conferir o resultado.",
      Entidade_Referencia: "Configuracoes",
      ID_Referencia: id,
      Status: "ABERTA",
      Criado_Em: at,
      Resolvido_Em: "",
      Resolvido_Por: "",
    };
  if (
    prior.length > 1 ||
    (prior.length &&
      !table.columns.every(function (k) {
        return prior[0][k] === row[k];
      }))
  )
    maintenanceFail_("MAINTENANCE_CONFLICT");
  if (!prior.length) notificationWrite_(table, row);
}
/* Google owner verification is the trust root when application factors are lost.
 * Re-enrollment still requires the NEW mailbox code, a fresh PIN and a new passkey. */
function recoverDevelopmentOwnerAccess(commandId, newEmail, caseReference) {
  var c = maintenanceGuard_(true);
  return withLock_(function () {
    var props = scriptProperties_(),
      email = accessEmail_(newEmail);
    if (
      !identityUuid_(commandId) ||
      typeof caseReference !== "string" ||
      !/^CASE-[A-Z0-9-]{8,80}$/.test(caseReference)
    )
      maintenanceFail_();
    var fingerprint = digest_(
        JSON.stringify([commandId, email, caseReference]),
      ),
      last = props.getProperty("MAINTENANCE_LAST_OWNER_RECOVERY");
    if (last) {
      last = JSON.parse(last);
      if (last.id === commandId) {
        if (last.fingerprint !== fingerprint)
          maintenanceFail_("MAINTENANCE_CONFLICT");
        maintenanceFinishMarker_(
          "MAINTENANCE_RECOVERY_PENDING",
          commandId,
          "OWNER_RECOVERY",
        );
        return {
          environment: "dev",
          reenrollmentRequired: true,
          backupId: last.backupId,
        };
      }
    }
    var pointer = props.getProperty("MAINTENANCE_RECOVERY_PENDING"),
      plan;
    if (pointer) {
      plan = maintenanceRead_(pointer);
      if (
        plan.kind !== "OWNER_RECOVERY" ||
        plan.id !== commandId ||
        plan.fingerprint !== fingerprint
      )
        maintenanceFail_("MAINTENANCE_CONFLICT");
    } else {
      maintenanceCommandUnused_(commandId);
      maintenanceQuiescent_();
      var owner = accessOwner_(c);
      if (!owner || owner.row.Perfil !== "SUPER_ADMIN") maintenanceFail_();
      var indexKey = props.getProperty("MAINTENANCE_PERSONAL_INDEX_KEY");
      if (
        !accessHash_(indexKey) ||
        [c.secret, maintenanceKey_()].includes(indexKey) ||
        !Number.isSafeInteger(owner.version + 1)
      )
        maintenanceFail_("MAINTENANCE_CONFIGURATION");
      var emailIndex = hex_(
        Utilities.computeHmacSha256Signature(
          Utilities.newBlob(
            JSON.stringify([
              "index.v1",
              c.environment,
              c.installationId,
              "email",
              email,
            ]),
          ).getBytes(),
          secretBytes_(indexKey),
        ),
      );
      var users = staffUsers_(storage_(c, false).spreadsheet);
      if (
        users.rows.some(function (u) {
          return (
            u.ID_Usuario !== owner.row.ID_Usuario &&
            u.Email_Indice === emailIndex
          );
        })
      )
        maintenanceFail_("MAINTENANCE_CONFLICT");
      var backup = maintenanceBackup_(c, commandId);
      plan = {
        version: 1,
        kind: "OWNER_RECOVERY",
        environment: "dev",
        installationId: c.installationId,
        id: commandId,
        userId: owner.row.ID_Usuario,
        epoch: owner.version + 1,
        email: email,
        emailIndex: emailIndex,
        fingerprint: fingerprint,
        caseHash: digest_(caseReference),
        backupId: backup.fileId,
        createdAt: new Date().toISOString(),
      };
      var file = maintenanceWrite_(
        maintenanceFolder_(c),
        "maintenance-owner-" + commandId + ".json",
        plan,
      );
      props.setProperty("MAINTENANCE_RECOVERY_PENDING", file.getId());
    }
    var main = storage_(c, false).spreadsheet,
      owner = accessOwner_(c);
    if (
      !owner ||
      owner.row.ID_Usuario !== plan.userId ||
      ![plan.epoch - 1, plan.epoch].includes(owner.version)
    )
      maintenanceFail_("MAINTENANCE_CONFLICT");
    staffPut_(
      main,
      "identity.version." + plan.userId,
      plan.epoch,
      plan.createdAt,
      "SYSTEM_AUTH",
    );
    var sessions = identityRows_(main, "Sessoes");
    sessions.rows
      .filter(function (r) {
        return r.ID_Usuario === plan.userId && !r.Revogado_Em;
      })
      .forEach(function (r) {
        r.Revogado_Em = plan.createdAt;
        accessSaveMain_(sessions, r);
      });
    var priv = authControlStore_(c),
      keys = passkeyCredentials_(priv);
    keys.rows
      .filter(function (r) {
        return r.Subject_ID === plan.userId && !r.Revoked_At;
      })
      .forEach(function (r) {
        r.Revoked_At = plan.createdAt;
        authControlSave_(keys, r);
      });
    var flows = accessFlows_(priv);
    flows.rows
      .filter(function (r) {
        return (
          r.Subject_ID === plan.userId &&
          !["COMPLETE", "REVOKED"].includes(r.State)
        );
      })
      .forEach(function (r) {
        r.State = "REVOKED";
        r.Pin_JSON = "";
        authControlSave_(flows, r);
      });
    var keyFlow = keyFlowRead_(c, plan.userId);
    if (keyFlow) {
      keyFlow.state = "CANCELLED";
      keyFlow.key = null;
      keyFlow.codes = null;
      keyFlowSave_(c, keyFlow);
    }
    var kit = emergencyKit_(c, plan.userId);
    if (kit) {
      kit.state = "INVALID";
      emergencySave_(
        c,
        "IDENTITY_RESCUE_CODES_" + plan.userId,
        kit,
        "emergency.codes",
      );
    }
    props.setProperty("IDENTITY_OWNER_LOGIN_EMAIL", plan.email);
    owner.row.Primeiro_Acesso_Concluido = false;
    owner.row.Email_Indice = plan.emailIndex;
    accessSaveMain_(owner.users, owner.row);
    maintenanceLog_(commandId, plan.createdAt, "IDENTITY_ADMIN_RECOVERY", {
      authorizationVersion: plan.epoch,
      otherSessionsRevoked: true,
      reenrollmentRequired: true,
      reasonRecorded: true,
    });
    props.setProperty(
      "MAINTENANCE_LAST_OWNER_RECOVERY",
      JSON.stringify({
        id: commandId,
        fingerprint: fingerprint,
        backupId: plan.backupId,
      }),
    );
    props.deleteProperty("MAINTENANCE_PERSONAL_INDEX_KEY");
    props.setProperty("MAINTENANCE_RECOVERY_PENDING", "");
    return {
      environment: "dev",
      reenrollmentRequired: true,
      backupId: plan.backupId,
    };
  });
}
function inspectDevelopmentRestore(commandId) {
  var c = maintenanceGuard_();
  return withLock_(function () {
    if (!identityUuid_(commandId)) maintenanceFail_();
    var it = maintenanceFolder_(c).getFilesByName(
      "maintenance-restore-" + commandId + ".json",
    );
    if (!it.hasNext()) maintenanceFail_();
    var restored = maintenanceRead_(it.next().getId());
    if (
      it.hasNext() ||
      restored.kind !== "RESTORE" ||
      !restored.recovered ||
      !restored.restoredProperties ||
      !Array.isArray(restored.tableHashes)
    )
      maintenanceFail_();
    var source = maintenanceRead_(restored.source);
    var checked = maintenanceWithCopy_(
      { properties: restored.restoredProperties },
      restored.aliases,
      function (copy) {
        assertSchema_(storage_(copy, true).spreadsheet);
        restored.tableHashes.forEach(function (t) {
          if (
            !restored.aliases[t.id] ||
            restored.aliases[t.id] === t.id ||
            digest_(
              JSON.stringify(maintenanceTables_(resourceSheet_(t.id))),
            ) !== t.hash
          )
            maintenanceFail_("MAINTENANCE_CONFLICT");
        });
        source.assets.forEach(function (a) {
          if (
            hex_(
              Utilities.computeDigest(
                Utilities.DigestAlgorithm.SHA_256,
                resourceFile_(a.id).getBlob().getBytes(),
              ),
            ) !== a.sha256
          )
            maintenanceFail_("MAINTENANCE_CONFLICT");
        });
        return true;
      },
    );
    return {
      environment: "dev",
      isolated: true,
      verified: checked,
      sheets: restored.tableHashes.length,
      assets: source.assets.length,
    };
  });
}
/* Opt-in schedule: installed only by the Google owner; no trigger is installed by publication. */
function installDevelopmentBackupSchedule(hours) {
  var c = maintenanceOwner_();
  return withLock_(function () {
    maintenanceKey_();
    maintenanceFolder_(c);
    if (![1, 2, 4, 6, 8, 12, 24].includes(hours)) maintenanceFail_();
    var props = scriptProperties_(),
      raw = props.getProperty("MAINTENANCE_BACKUP_SCHEDULE"),
      prior = raw ? JSON.parse(raw) : null;
    var existing = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === "runDevelopmentBackupJob";
    });
    if (existing.length) {
      if (
        existing.length !== 1 ||
        !prior ||
        prior.id !== existing[0].getUniqueId() ||
        prior.hours !== hours ||
        !prior.enabled
      )
        maintenanceFail_("MAINTENANCE_CONFLICT");
      return { environment: "dev", scheduled: true, hours: hours };
    }
    var trigger = ScriptApp.newTrigger("runDevelopmentBackupJob")
      .timeBased()
      .everyHours(hours)
      .create();
    props.setProperty(
      "MAINTENANCE_BACKUP_SCHEDULE",
      JSON.stringify({
        id: trigger.getUniqueId(),
        hours: hours,
        enabled: true,
      }),
    );
    return { environment: "dev", scheduled: true, hours: hours };
  });
}
function removeDevelopmentBackupSchedule() {
  maintenanceOwner_();
  return withLock_(function () {
    var props = scriptProperties_(),
      raw = props.getProperty("MAINTENANCE_BACKUP_SCHEDULE"),
      p = raw ? JSON.parse(raw) : null;
    if (!p) return { environment: "dev", scheduled: false };
    p.enabled = false;
    props.setProperty("MAINTENANCE_BACKUP_SCHEDULE", JSON.stringify(p));
    ScriptApp.getProjectTriggers()
      .filter(function (t) {
        return (
          t.getUniqueId() === p.id &&
          t.getHandlerFunction() === "runDevelopmentBackupJob"
        );
      })
      .forEach(function (t) {
        ScriptApp.deleteTrigger(t);
      });
    return { environment: "dev", scheduled: false };
  });
}
function runDevelopmentBackupJob(event) {
  var c = baseSettings_(),
    props = scriptProperties_(),
    raw = props.getProperty("MAINTENANCE_BACKUP_SCHEDULE"),
    p = raw ? JSON.parse(raw) : null;
  if (
    c.environment !== "dev" ||
    Session.getEffectiveUser().getEmail().toLowerCase() !== c.owner ||
    !p ||
    !p.enabled ||
    !event ||
    event.triggerUid !== p.id ||
    ![1, 2, 4, 6, 8, 12, 24].includes(p.hours) ||
    !ScriptApp.getProjectTriggers().some(function (t) {
      return (
        t.getUniqueId() === p.id &&
        t.getHandlerFunction() === "runDevelopmentBackupJob"
      );
    })
  )
    maintenanceFail_("FORBIDDEN");
  return withLock_(function () {
    if (props.getProperty("MAINTENANCE_MODE") === "true")
      return { environment: "dev", skipped: true };
    var hash = digest_(
        JSON.stringify([
          "scheduled-backup.v1",
          c.installationId,
          p.id,
          Math.floor(Date.now() / (p.hours * 3600000)),
        ]),
      ),
      id =
        hash.slice(0, 8) +
        "-" +
        hash.slice(8, 12) +
        "-4" +
        hash.slice(13, 16) +
        "-8" +
        hash.slice(17, 20) +
        "-" +
        hash.slice(20, 32);
    var saved = maintenanceBackup_(c, id),
      body = maintenanceRead_(saved.fileId);
    maintenanceLog_(id, body.createdAt, "MAINTENANCE_BACKUP", {
      count: body.sheets.length,
    });
    return { environment: "dev", backedUp: true };
  });
}
