// CONTRACT DOUBLE ONLY: no Google APIs, IAM, quotas or real Drive persistence.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
export function createGasEmulator(initialProperties = {}) {
  let counter = 0, backupCount = 0, writes = 0, owner = 'owner@example.invalid';
  let failOnSheet = null, locked = false;
  const resources = new Map(), sheets = new Map(), props = { ...initialProperties }, outbox = [];
  let mailQuota = 100, mailFailure = false;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.formats = []; }
    getLastRow() { let n = this.rows.length; while (n && !this.rows[n - 1].some(v => v !== '' && v !== undefined)) n--; return n; }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
    getMaxRows() { return 1000; }
    setFrozenRows() { return this; }
    getRange(row, col, height, width) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: values => { writes++; values.forEach((cells, i) => { this.rows[row - 1 + i] ||= []; cells.forEach((value, j) => this.rows[row - 1 + i][col - 1 + j] = value); }); },
        clearContent: () => { writes++; for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) if (this.rows[row - 1 + i]) this.rows[row - 1 + i][col - 1 + j] = ''; },
        setNumberFormat: format => { this.formats.push({ row, col, height, width, format }); },
      };
    }
    appendRow(values) { writes++; this.rows[this.getLastRow()] = [...values]; return this; }
  }
  class Resource {
    constructor(kind, name) { this.id = `${kind}_${++counter}_${'x'.repeat(24)}`; this.kind = kind; this.name = name; this.description = ''; this.sharing = 'private'; resources.set(this.id, this); }
    getId() { return this.id; }
    getDescription() { return this.description; }
    getSharingAccess() { return this.sharing; }
    getName() { return this.name; }
    getMimeType() { return this.mime || ''; }
    getSize() { return this.bytes?.length || 0; }
    getParents() { const list = this.parent ? [resources.get(this.parent)] : []; let i=0; return {hasNext:()=>i<list.length,next:()=>list[i++]}; }
    getBlob() { return blob(this.bytes,this.mime,this.name); }
    getFilesByName(name) { const list=[...resources.values()].filter(r=>r.parent===this.id&&r.name===name&&r.kind==='image');let i=0;return{hasNext:()=>i<list.length,next:()=>list[i++]}; }
    createFile(value) { const file = new Resource('image',value.getName());file.bytes=Buffer.from(value.getBytes());file.mime=value.getContentType();file.parent=this.id;writes++;return file; }
    setDescription(value) { writes++; this.description = value; return this; }
    moveTo(folder) { this.parent = folder.id; return this; }
    createFolder(name) { const r = new Resource('folder', name); r.parent = this.id; return r; }
    makeCopy(name, folder) {
      backupCount++;
      const r = new Resource('backup', name); r.parent = folder.id;
      r.snapshot = JSON.parse(JSON.stringify([...sheets.get(this.id).tables].map(([name, sheet]) => [name, sheet.rows])));
      return r;
    }
  }
  class Spreadsheet {
    constructor(file) { this.file = file; this.tables = new Map(); }
    getId() { return this.file.id; }
    getSheetByName(name) { return this.tables.get(name) || null; }
    insertSheet(name) {
      if (name === failOnSheet) throw new Error('INJECTED_STORAGE_FAILURE');
      writes++; const s = new Sheet(name); this.tables.set(name, s); return s;
    }
  }
  const blob = (value,mime='',name='') => {
    const bytes = Buffer.isBuffer(value) || Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), 'utf8');
    return { getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8'),getContentType:()=>mime,getName:()=>name };
  };
  const context = vm.createContext({
    Date, JSON, Object, Array, Number, String, Math, Error, Set, console: { info() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: key => props[key] || null, setProperty: (key, value) => { props[key] = value; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    DriveApp: { Access: { PRIVATE: 'private' }, createFolder: name => new Resource('folder', name), getFolderById: id => { const r = resources.get(id); if (r?.kind !== 'folder') throw new Error('UNKNOWN_FOLDER'); return r; }, getFileById: id => { const r = resources.get(id); if (!r) throw new Error('UNKNOWN_FILE'); return r; } },
    SpreadsheetApp: { create: name => { const f = new Resource('sheet', name), ss = new Spreadsheet(f); sheets.set(f.id, ss); return ss; }, openById: id => { if (!sheets.has(id)) throw new Error('UNKNOWN_SHEET'); return sheets.get(id); }, flush() {} },
    Utilities: { newBlob: blob, base64Encode: value => Buffer.from(value).toString('base64'), base64Decode: value => [...Buffer.from(value, 'base64')], computeHmacSha256Signature: (value, key) => [...createHmac('sha256', Buffer.from(key)).update(Buffer.from(value)).digest()], computeDigest: (_, value) => [...createHash('sha256').update(Array.isArray(value)?Buffer.from(value):value).digest()], DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF-8' } },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    MailApp: { getRemainingDailyQuota: () => mailQuota, sendEmail: value => { if (mailFailure) throw Error('FAKE_MAIL_FAILURE'); outbox.push(value); mailQuota--; } },
  });
  context.Utilities.getUuid = randomUUID;
  for (const name of ['Schema.gs', 'Code.gs', 'Sales.gs', 'Stock.gs', 'Notifications.gs', 'SessionStore.gs', 'AuthControl.gs', 'PasskeyStore.gs', 'OwnerAccess.gs', 'Catalog.gs', 'CoverPhotos.gs']) vm.runInContext(readFileSync(new URL(`../../google-apps-script/${name}`, import.meta.url), 'utf8'), context);
  return { context, props, resources, sheets, outbox,
    call(name, ...args) { return context[name](...args); },
    post(envelope) { return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(envelope) } }).text); },
    get backupCount() { return backupCount; }, get writes() { return writes; },
    set failOnSheet(value) { failOnSheet = value; }, set locked(value) { locked = value; }, set owner(value) { owner = value; },
    set mailQuota(value) { mailQuota = value; }, set mailFailure(value) { mailFailure = value; },
  };
}
