import { createHmac } from 'node:crypto';
import { lookupResendEmail, sendResendEmail } from './email-provider.mjs';
import { sealEmailDelivery, openEmailDelivery } from './email-delivery-crypto.mjs';
import { ApiError } from './errors.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_NOTIFICATIONS = 5000;

function unavailable() { throw new ApiError(503, 'NOTIFICATIONS_UNAVAILABLE'); }
function hmacId(config, productId, version) {
  if (!config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret)) throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
  const digest = createHmac('sha256', Buffer.from(config.secret, 'hex')).update(JSON.stringify(['stock-alert.v1', config.installationId, productId, version])).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function date(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) unavailable();
  return result;
}
function data(snapshot) {
  if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== 'function') unavailable();
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}

export function enqueueStockAlertProjection(transaction, repositories, { productId, version, now = new Date() }) {
  if (typeof productId !== 'string' || !productId || !Number.isSafeInteger(version) || version < 1) unavailable();
  const entry = { id: `stock-alert:${productId}:${version}`, type: 'STOCK_ALERT_SYNC', aggregate: 'products', aggregateId: productId,
    aggregateVersion: version, state: 'PENDING', attempts: 0, nextAttemptAt: date(now), createdAt: date(now), updatedAt: date(now), errorCode: null };
  repositories.transaction.set(transaction, 'outbox', entry.id, entry);
  return entry.id;
}

export function enqueueScheduleNotificationProjection(transaction, repositories, { commandId, scheduleId, version, plan, now = new Date() }) {
  if (typeof commandId !== 'string' || typeof scheduleId !== 'string' || !Number.isSafeInteger(version) || version < 1 || !Array.isArray(plan) || plan.length > 2) unavailable();
  const at = date(now);
  const entry = { id: `schedule-notification:${commandId}`, type: 'SCHEDULE_NOTIFICATION_SYNC', aggregate: 'schedules', aggregateId: scheduleId,
    aggregateVersion: version, state: 'PENDING', attempts: 0, nextAttemptAt: at, createdAt: at, updatedAt: at, errorCode: null, payload: { plan } };
  repositories.transaction.set(transaction, 'outbox', entry.id, entry);
  return entry.id;
}
export function enqueueEmailDelivery(transaction, repositories, { settings, idempotencyKey, to, subject, text, now = new Date() }) {
  if (typeof idempotencyKey !== 'string' || typeof to !== 'string' || typeof subject !== 'string' || typeof text !== 'string') unavailable();
  const at = date(now), entry = { id: `email:${idempotencyKey}`, type: 'EMAIL_DELIVERY', idempotencyKey, state: 'PENDING', attempts: 0, nextAttemptAt: at,
    createdAt: at, updatedAt: at, errorCode: null, payload: { recipientCiphertext: sealEmailDelivery(settings, 'recipient', idempotencyKey, to),
      deliveryCiphertext: sealEmailDelivery(settings, 'body', idempotencyKey, text), subject } };
  repositories.transaction.set(transaction, 'outbox', entry.id, entry);
  return entry.id;
}
function auditEntry(id, event, notification, now) {
  return { id, at: now.toISOString(), commandId: event.id, actorId: 'SYSTEM_STOCK', role: 'SYSTEM', operation: event.operation,
    entity: 'Notificacoes', entityId: notification.id, result: 'SUCESSO', requestId: event.id, before: event.before || null,
    after: event.after || null, detailsOmitted: false };
}

export async function deliverEmailEntry(entry, config, { send = sendResendEmail } = {}) {
  const settings = config?.firestore;
  if (!settings?.emailProviderKey || settings.emailProvider !== 'resend' || !settings.emailFrom) throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE');
  const idempotencyKey = entry.idempotencyKey || entry.id.replace(/^email:/, '');
  const to = openEmailDelivery(settings, 'recipient', idempotencyKey, entry.payload.recipientCiphertext);
  const text = openEmailDelivery(settings, 'body', idempotencyKey, entry.payload.deliveryCiphertext || entry.payload.textCiphertext);
  return send({ apiKey: settings.emailProviderKey, from: settings.emailFrom, to, subject: entry.payload.subject, text, idempotencyKey: entry.id });
}

async function lookupEmailEntry(entry, config, { lookup = lookupResendEmail } = {}) {
  const settings = config?.firestore;
  if (!settings?.emailProviderKey || settings.emailProvider !== 'resend' || !settings.emailFrom || !entry.providerId) {
    throw new ApiError(503, 'EMAIL_DELIVERY_RESULT_UNKNOWN');
  }
  return lookup({ apiKey: settings.emailProviderKey, providerId: entry.providerId, idempotencyKey: entry.id });
}

async function processScheduleEntry(transaction, { db, repositories, entry, currentTime }) {
  const plan = entry.payload?.plan;
  if (!Array.isArray(plan) || plan.length > 2) unavailable();
  const now = new Date(currentTime), pending = [];
  for (const item of plan) {
    if (!item || typeof item.id !== 'string' || !['SCHEDULE_PUBLISHED', 'SCHEDULE_CHANGED', 'SCHEDULE_CANCELLED'].includes(item.type) ||
        typeof item.recipientId !== 'string' || typeof item.scheduleId !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(item.date || '') ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end || '') || item.end <= item.start) unavailable();
    const ref = repositories.ref('notifications', item.id);
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? data(snapshot) : null;
    const title = item.type === 'SCHEDULE_PUBLISHED' ? 'Escala publicada' : item.type === 'SCHEDULE_CANCELLED' ? 'Escala cancelada' : 'Escala alterada';
    const message = `${title}: ${item.date.split('-').reverse().join('/')}, das ${item.start} às ${item.end}. Confira sua escala.`;
    const notification = { id: item.id, type: item.type, priority: 'MEDIA', title, message, entityType: 'Escalas', referenceId: item.scheduleId,
      scheduleId: item.scheduleId, recipientId: item.recipientId, state: 'ABERTA', createdAt: now, resolvedAt: null, resolvedBy: null,
      audience: 'USER', date: item.date, start: item.start, end: item.end, sourceVersion: item.version };
    if (existing && JSON.stringify({ ...existing, createdAt: undefined, updatedAt: undefined }) !== JSON.stringify({ ...notification, createdAt: undefined, updatedAt: undefined })) unavailable();
    pending.push({ ref, existing, notification });
  }
  for (const item of pending) if (!item.existing) transaction.create(item.ref, item.notification);
  repositories.transaction.update(transaction, 'outbox', entry.id, { state: 'SUCCEEDED', attempts: entry.attempts + 1, updatedAt: now, completedAt: now, errorCode: null });
  return { processed: true, notificationChanges: pending.filter(item => !item.existing).length };
}

async function processStockEntry(transaction, { db, repositories, config, entry, currentTime }) {
  const productSnapshot = await repositories.transaction.get(transaction, 'products', entry.aggregateId);
  const product = data(productSnapshot);
  if (!Number.isSafeInteger(product.stock) || !Number.isSafeInteger(product.minimumStock) || typeof product.active !== 'boolean' ||
      !Number.isSafeInteger(product.version)) unavailable();
  const notificationsSnapshot = await transaction.get(db.collection('notifications'));
  if (!notificationsSnapshot || !Array.isArray(notificationsSnapshot.docs) || notificationsSnapshot.docs.length > MAX_NOTIFICATIONS) unavailable();
  const current = notificationsSnapshot.docs.map(snapshot => ({ snapshot, value: data(snapshot) })).filter(item => item.value.referenceId === entry.aggregateId &&
    ['STOCK_ZERO', 'STOCK_LOW'].includes(item.value.type) && item.value.state !== 'RESOLVIDA');
  const type = product.active && product.stock === 0 ? 'STOCK_ZERO' : product.active && product.stock < product.minimumStock ? 'STOCK_LOW' : null;
  const priority = type === 'STOCK_ZERO' ? 'ALTA' : 'MEDIA';
  const notificationId = type ? hmacId(config, entry.aggregateId, product.version) : null;
  const now = new Date(currentTime), auditPlans = [];
  const plan = [];
  if (!type) {
    for (const item of current) {
      const notification = { id: item.value.id || item.snapshot.id, ...item.value };
      const auditRef = repositories.ref('auditEvents', `notification:${notification.id}:resolved`);
      const auditSnapshot = await transaction.get(auditRef);
      plan.push({ ref: item.snapshot.ref || repositories.ref('notifications', notification.id), value: notification, next: { state: 'RESOLVIDA', resolvedAt: now, resolvedBy: 'SYSTEM_STOCK', updatedAt: now } });
      if (!auditSnapshot.exists) auditPlans.push({ ref: auditRef, event: { id: `notification:${notification.id}:resolved`, operation: 'STOCK_ALERT_RESOLVED', before: { state: notification.state }, after: { state: 'RESOLVIDA' } } });
    }
  } else {
    const title = product.title;
    const message = `Estoque atual: ${product.stock}. Estoque mínimo: ${product.minimumStock}.`;
    const matching = current.find(item => (item.value.id || item.snapshot.id) === notificationId);
    for (const item of current) {
      const id = item.value.id || item.snapshot.id;
      if (!matching || id !== notificationId) {
        const auditRef = repositories.ref('auditEvents', `notification:${id}:resolved`);
        const auditSnapshot = await transaction.get(auditRef);
        plan.push({ ref: item.snapshot.ref || repositories.ref('notifications', id), value: { id, ...item.value }, next: { state: 'RESOLVIDA', resolvedAt: now, resolvedBy: 'SYSTEM_STOCK', updatedAt: now } });
        if (!auditSnapshot.exists) auditPlans.push({ ref: auditRef, event: { id: `notification:${id}:resolved`, operation: 'STOCK_ALERT_RESOLVED', before: { state: item.value.state }, after: { state: 'RESOLVIDA' } } });
      }
    }
    if (matching) {
      plan.push({ ref: matching.snapshot.ref || repositories.ref('notifications', notificationId), value: { id: notificationId, ...matching.value }, next: { title, message, priority, updatedAt: now } });
    } else {
      const notification = { id: notificationId, type, priority, title, message, entityType: 'Produtos', referenceId: entry.aggregateId,
        state: 'ABERTA', createdAt: now, resolvedAt: null, resolvedBy: null, audience: 'ALL_STAFF', episodeKey: `stock:${entry.aggregateId}:${product.version}`, sourceVersion: product.version, updatedAt: now };
      const notificationRef = repositories.ref('notifications', notificationId);
      const notificationSnapshot = await transaction.get(notificationRef);
      if (!notificationSnapshot.exists) plan.push({ ref: notificationRef, create: true, value: notification });
      const auditRef = repositories.ref('auditEvents', `notification:${notificationId}:opened`);
      const auditSnapshot = await transaction.get(auditRef);
      if (!auditSnapshot.exists) auditPlans.push({ ref: auditRef, event: { id: `notification:${notificationId}:opened`, operation: 'STOCK_ALERT_OPENED', before: null, after: { productId: entry.aggregateId, type } } });
    }
  }
  for (const item of plan) {
    if (item.create) transaction.create(item.ref, item.value);
    else transaction.update(item.ref, item.next);
  }
  for (const item of auditPlans) transaction.create(item.ref, auditEntry(item.event.id, item.event, { id: item.event.id.replace(/:(opened|resolved)$/, '') }, now));
  repositories.transaction.update(transaction, 'outbox', entry.id, { state: 'SUCCEEDED', attempts: entry.attempts + 1, updatedAt: now, completedAt: now, errorCode: null });
  return { processed: true, notificationChanges: plan.length };
}

export async function processPendingFirestoreOutbox({ db, config, now = () => Date.now(), transactionOptions, provider = {} } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const send = provider.send || sendResendEmail;
  const lookup = provider.lookup || lookupResendEmail;
  const result = await runFirestoreTransaction(db, async transaction => {
    const currentTime = now();
    const snapshot = await transaction.get(db.collection('outbox'));
    if (!snapshot || !Array.isArray(snapshot.docs)) unavailable();
    const candidate = snapshot.docs.map(item => ({ ref: item.ref || repositories.ref('outbox', item.id), value: data(item) }))
      .filter(item => ['PENDING', 'UNCERTAIN'].includes(item.value.state) && date(item.value.nextAttemptAt).getTime() <= currentTime)
      .sort((a, b) => date(a.value.nextAttemptAt).getTime() - date(b.value.nextAttemptAt).getTime())[0];
    if (!candidate) return { processed: false, notificationChanges: 0 };
    if (candidate.value.type === 'STOCK_ALERT_SYNC') return processStockEntry(transaction, { db, repositories, config, entry: candidate.value, currentTime });
    if (candidate.value.type === 'SCHEDULE_NOTIFICATION_SYNC') return processScheduleEntry(transaction, { db, repositories, entry: candidate.value, currentTime });
    if (candidate.value.type === 'EMAIL_DELIVERY') {
      const leaseUntil = new Date(currentTime + 60000);
      repositories.transaction.update(transaction, 'outbox', candidate.value.id, { state: 'PROCESSING', attempts: candidate.value.attempts + 1, leaseUntil, updatedAt: new Date(currentTime) });
      return { processed: true, emailPending: { ...candidate.value, attempts: candidate.value.attempts + 1 } };
    }
    repositories.transaction.update(transaction, 'outbox', candidate.value.id, { state: 'DEAD', attempts: candidate.value.attempts + 1, updatedAt: new Date(currentTime), errorCode: 'OUTBOX_TYPE_UNSUPPORTED' });
    return { processed: true, notificationChanges: 0 };
  }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  if (!result.emailPending) return result;

  const entry = result.emailPending;
  const saveState = async (patch) => runFirestoreTransaction(db, transaction => {
    repositories.transaction.update(transaction, 'outbox', entry.id, patch);
  }, { maxAttempts: 3 });
  const saveSuccess = async providerId => {
    if (typeof providerId !== 'string' || !providerId) throw new ApiError(503, 'EMAIL_DELIVERY_RESULT_UNKNOWN');
    await saveState({ state: 'SUCCEEDED', providerId, completedAt: new Date(now()), updatedAt: new Date(now()), errorCode: null, leaseUntil: null });
    return { processed: true, emailSent: true };
  };
  const saveUncertain = async error => {
    const at = now();
    await saveState({ state: 'UNCERTAIN', nextAttemptAt: new Date(at + Math.min(3600000, 1000 * 3 ** Math.min(entry.attempts, 8))), updatedAt: new Date(at), errorCode: error?.code || 'EMAIL_DELIVERY_RESULT_UNKNOWN', leaseUntil: null });
    return { processed: true, emailSent: false, uncertain: true, terminal: false };
  };
  const saveFailure = async error => {
    const at = now(), terminal = entry.attempts >= 5;
    await saveState({ state: terminal ? 'DEAD' : 'PENDING', nextAttemptAt: new Date(at + Math.min(3600000, 250 * 3 ** entry.attempts)), updatedAt: new Date(at), errorCode: error?.code || 'EMAIL_DELIVERY_UNAVAILABLE', leaseUntil: null });
    return { processed: true, emailSent: false, terminal };
  };
  const resolve = async () => lookupEmailEntry(entry, config, { lookup });

  if (entry.state === 'UNCERTAIN') {
    try {
      const found = await resolve();
      if (found?.status === 'FOUND') return saveSuccess(found.id);
      if (found?.status !== 'NOT_FOUND') return saveUncertain(new ApiError(503, 'EMAIL_DELIVERY_RESULT_UNKNOWN'));
    } catch (error) {
      if (error?.code === 'EMAIL_DELIVERY_RESULT_UNKNOWN' || error?.code === 'EMAIL_DELIVERY_QUOTA') return saveUncertain(error);
      return saveFailure(error);
    }
  }

  try {
    const providerResult = await deliverEmailEntry(entry, config, { send });
    return saveSuccess(providerResult.id);
  } catch (error) {
    if (error?.code === 'EMAIL_DELIVERY_RESULT_UNKNOWN') {
      try {
        const found = await resolve();
        if (found?.status === 'FOUND') return saveSuccess(found.id);
        if (found?.status === 'NOT_FOUND') {
          const retryResult = await deliverEmailEntry(entry, config, { send });
          return saveSuccess(retryResult.id);
        }
      } catch (lookupError) {
        return saveUncertain(lookupError);
      }
      return saveUncertain(new ApiError(503, 'EMAIL_DELIVERY_RESULT_UNKNOWN'));
    }
    return saveFailure(error);
  }
}


