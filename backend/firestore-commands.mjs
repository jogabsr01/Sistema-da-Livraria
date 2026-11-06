import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { assertFirestoreDocumentSize } from './firestore-repositories.mjs';

const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/;

function invalid() {
  throw new ApiError(400, 'INVALID_FIRESTORE_COMMAND');
}

function conflict() {
  throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
}

function corrupt() {
  throw new ApiError(503, 'FIRESTORE_COMMAND_CORRUPT');
}

function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = stable(value[key]);
    }
    return result;
  }
  invalid();
}

export function createCommandFingerprint(value) {
  const canonical = stable(value);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function commandDocumentId(domain, commandId) {
  if (typeof domain !== 'string' || !NAME.test(domain) || typeof commandId !== 'string' ||
      !commandId || commandId.includes('/') || Buffer.byteLength(commandId, 'utf8') > 1300) invalid();
  return `${domain}:${commandId}`;
}

function actorId(value) {
  if (value === null || value === undefined) return 'SYSTEM';
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 160) invalid();
  return value;
}

function date(value, fallback = new Date()) {
  const result = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (!(result instanceof Date) || !Number.isFinite(result.getTime())) invalid();
  return result;
}

export function createCommandMetadata({ domain, commandId, operation, actor, payloadHash, now = new Date(), retentionMs }) {
  commandDocumentId(domain, commandId);
  if (typeof operation !== 'string' || !NAME.test(operation) || typeof payloadHash !== 'string' || !HASH.test(payloadHash) ||
      retentionMs !== undefined && (!Number.isSafeInteger(retentionMs) || retentionMs < 0)) invalid();
  const createdAt = date(now);
  const expiresAt = retentionMs === undefined ? undefined : new Date(createdAt.getTime() + retentionMs);
  const metadata = {
    domain,
    commandId,
    operation,
    actorId: actorId(actor),
    payloadHash,
    state: 'PENDING',
    createdAt,
    updatedAt: createdAt,
  };
  if (expiresAt) metadata.expiresAt = expiresAt;
  return metadata;
}

function validStoredCommand(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    NAME.test(value.domain || '') && typeof value.commandId === 'string' && value.commandId &&
    NAME.test(value.operation || '') && typeof value.actorId === 'string' && value.actorId &&
    HASH.test(value.payloadHash || '') && ['PENDING', 'COMMITTED'].includes(value.state) &&
    value.createdAt && value.updatedAt;
}

export async function inspectCommand(transaction, ref, metadata) {
  if (!transaction || typeof transaction.get !== 'function' ||
      !ref || !metadata || metadata.state !== 'PENDING') invalid();
  const snapshot = await transaction.get(ref);
  if (!snapshot || typeof snapshot.exists !== 'boolean') corrupt();
  if (!snapshot.exists) return { status: 'NEW', metadata };
  const existing = snapshot.data?.();
  if (!validStoredCommand(existing)) corrupt();
  if (existing.domain !== metadata.domain || existing.commandId !== metadata.commandId ||
      existing.operation !== metadata.operation || existing.actorId !== metadata.actorId ||
      existing.payloadHash !== metadata.payloadHash) conflict();
  if (existing.state === 'COMMITTED') {
    if (!Object.hasOwn(existing, 'result')) corrupt();
    return { status: 'COMMITTED', result: structuredClone(existing.result) };
  }
  return { status: 'PENDING', metadata: existing };
}

export function createPendingCommand(transaction, ref, metadata) {
  if (!transaction || typeof transaction.create !== 'function' || !ref || !metadata || metadata.state !== 'PENDING') invalid();
  assertFirestoreDocumentSize(metadata);
  transaction.create(ref, metadata);
  return { status: 'NEW', metadata };
}

export async function beginCommand(transaction, ref, metadata) {
  const state = await inspectCommand(transaction, ref, metadata);
  if (state.status === 'NEW') return createPendingCommand(transaction, ref, metadata);
  return state;
}

export function commitCommand(transaction, ref, result, now = new Date()) {
  if (!transaction || typeof transaction.update !== 'function') invalid();
  assertFirestoreDocumentSize(result);
  const updatedAt = date(now);
  transaction.update(ref, { state: 'COMMITTED', result: structuredClone(result), updatedAt });
  return { state: 'COMMITTED', result: structuredClone(result), updatedAt };
}

export function commandRetention(days) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) invalid();
  return days * 24 * 60 * 60 * 1000;
}
