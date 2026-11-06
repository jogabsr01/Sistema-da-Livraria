import { ApiError } from './errors.mjs';
import { FIRESTORE_COLLECTIONS } from './firestore-schema.mjs';

export const MAX_FIRESTORE_DOCUMENT_BYTES = 900 * 1024;
const APPEND_ONLY_COLLECTIONS = new Set(['auditEvents', 'domainEvents', 'stockMovements']);
const DOCUMENT_ID_BYTES = 1500;

function invalid() {
  throw new ApiError(400, 'INVALID_FIRESTORE_DOCUMENT');
}

function immutable() {
  throw new ApiError(409, 'FIRESTORE_IMMUTABLE');
}

function segment(value) {
  if (typeof value !== 'string' || !value || value.includes('/') || Buffer.byteLength(value, 'utf8') > DOCUMENT_ID_BYTES) invalid();
  return value;
}

function collectionName(value) {
  if (!FIRESTORE_COLLECTIONS.includes(value)) invalid();
  return value;
}

export function assertFirestoreDocumentSize(value, maxBytes = MAX_FIRESTORE_DOCUMENT_BYTES) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) invalid();
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { invalid(); }
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes) invalid();
  return value;
}

function assertMutable(name) {
  if (APPEND_ONLY_COLLECTIONS.has(name)) immutable();
}

function docRef(db, name, id) {
  return db.collection(collectionName(name)).doc(segment(id));
}

function subcollectionRef(db, parentName, parentId, childName, childId) {
  return docRef(db, parentName, parentId).collection(segment(childName)).doc(segment(childId));
}

function requireDb(db) {
  if (!db || typeof db.collection !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  return db;
}

export function createFirestoreRepositories(db) {
  requireDb(db);

  const repositories = {
    ref: (name, id) => docRef(db, name, id),
    subref: (parentName, parentId, childName, childId) => subcollectionRef(db, parentName, parentId, childName, childId),
    collection: name => db.collection(collectionName(name)),
    async get(name, id) {
      return docRef(db, name, id).get();
    },
    async data(name, id) {
      const snapshot = await repositories.get(name, id);
      return snapshot.exists ? snapshot.data() : null;
    },
    async create(name, id, value) {
      assertFirestoreDocumentSize(value);
      return docRef(db, name, id).create(value);
    },
    async set(name, id, value, options) {
      assertMutable(collectionName(name));
      assertFirestoreDocumentSize(value);
      return options === undefined ? docRef(db, name, id).set(value) : docRef(db, name, id).set(value, options);
    },
    async update(name, id, value) {
      assertMutable(collectionName(name));
      assertFirestoreDocumentSize(value);
      return docRef(db, name, id).update(value);
    },
    async delete(name, id) {
      assertMutable(collectionName(name));
      return docRef(db, name, id).delete();
    },
    transaction: {
      ref: (name, id) => docRef(db, name, id),
      subref: (parentName, parentId, childName, childId) => subcollectionRef(db, parentName, parentId, childName, childId),
      get: (transaction, name, id) => transaction.get(docRef(db, name, id)),
      create: (transaction, name, id, value) => {
        assertFirestoreDocumentSize(value);
        return transaction.create(docRef(db, name, id), value);
      },
      set: (transaction, name, id, value, options) => {
        assertMutable(collectionName(name));
        assertFirestoreDocumentSize(value);
        return options === undefined ? transaction.set(docRef(db, name, id), value) : transaction.set(docRef(db, name, id), value, options);
      },
      update: (transaction, name, id, value) => {
        assertMutable(collectionName(name));
        assertFirestoreDocumentSize(value);
        return transaction.update(docRef(db, name, id), value);
      },
      delete: (transaction, name, id) => {
        assertMutable(collectionName(name));
        return transaction.delete(docRef(db, name, id));
      },
    },
  };

  return Object.freeze(repositories);
}
