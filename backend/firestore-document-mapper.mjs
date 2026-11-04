import { createHash } from 'node:crypto';
import { catalogUuid, normalizeProduct } from './catalog-model.mjs';
import { normalizeNiche } from './niche-model.mjs';
import { normalizeCustomer } from './customer-model.mjs';
import { createPersonalDataVault } from './personal-data.mjs';

const fail = () => { throw Error('DOCUMENT_MAPPING_INVALID'); };
const tokens = record => {
  const output = new Set();
  for (const key of ['title', 'author', 'isbn', 'internalCode']) {
    const value = record[key].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (let size = 1; size <= 3; size++) for (let i = 0; i + size <= value.length; i++) output.add(value.slice(i, i + size));
  }
  return [...output].sort();
};
function metadata(id, actorId, timestamp, version) {
  if (!catalogUuid(id) || !catalogUuid(actorId) || !Number.isSafeInteger(version) || version < 1 ||
      typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) fail();
  return { createdAt: timestamp, createdBy: actorId, updatedAt: timestamp, updatedBy: actorId, version };
}
function media(value, timestamp) {
  if (value === null) return null;
  if (!value || typeof value.bytes !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.bytes) || value.bytes.length > 65536) fail();
  const bytes = Buffer.from(value.bytes, 'base64');
  if (bytes.length < 4 || bytes.length > 49152 || bytes.toString('base64') !== value.bytes || createHash('sha256').update(bytes).digest('hex') !== value.sha256) fail();
  return { bytes: value.bytes, sha256: value.sha256, updatedAt: timestamp };
}

// Pure mapping only. No IDs are invented; callers must resolve legacy UUIDs explicitly.
// The returned documents can contain private data and must not be logged.
export function mapNicheDocuments({ id, actorId, timestamp, version, record, image }) {
  const meta = metadata(id, actorId, timestamp, version);
  const niche = normalizeNiche(record), photo = media(image, timestamp);
  const documents = [{ path: `niches/${id}`, data: { id, ...niche, ...meta, hasImage: photo !== null } },
    { path: `uniqueness/niche-name:${niche.name.trim().toLowerCase()}`, data: { nicheId: id } }];
  if (photo) documents.push({ path: `niches/${id}/media/image`, data: photo });
  return documents;
}

export function mapProductDocuments({ id, actorId, timestamp, version, record, stock, cover }) {
  const meta = metadata(id, actorId, timestamp, version);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) fail();
  const product = normalizeProduct(record, id), photo = media(cover, timestamp);
  if (photo && product.coverUrl) fail();
  const documents = [{ path: `products/${id}`, data: { ...product, ...meta, stock, hasPhoto: photo !== null } },
    { path: `productSearch/${id}`, data: { productId: id, active: product.active, nicheIds: product.nicheIds, tokens: tokens(product), updatedAt: timestamp, version } }];
  if (product.active && (product.isbn || product.internalCode)) {
    const kind = product.isbn ? 'ISBN' : 'CODE', value = product.isbn || product.internalCode;
    documents.push({ path: `uniqueness/active-${product.isbn ? 'isbn' : 'code'}:${value}`, data: { ownerId: id, kind, value, version, active: true } });
  }
  if (photo) documents.push({ path: `products/${id}/media/cover`, data: photo });
  return documents;
}

// AES-GCM always uses a fresh random nonce. The stable HMAC is for comparison;
// callers must reuse committed ciphertext after a matching checkpoint, not reseal it.
export function mapCustomerDocuments({ id, record, timestamp, consentAt, lastPurchase, vaultSettings }) {
  if (!catalogUuid(id) || !validTimestamp(timestamp) || !(consentAt === '' || validTimestamp(consentAt)) ||
      !(lastPurchase === '' || validTimestamp(lastPurchase))) fail();
  const normalized = normalizeCustomer(record);
  if (normalized.marketingConsent && !consentAt) fail();
  const vault = createPersonalDataVault(vaultSettings);
  const cpfIndex = vault.index('customer.cpf', normalized.cpf);
  const fingerprint = vault.fingerprint(['migration.customer.v1', id, normalized, timestamp, consentAt, lastPurchase]);
  return { fingerprint, documents: [
    { path: `customers/${id}`, data: { id, revision: 1, contact: vault.seal('customers', id, normalized), cpfIndex,
      contactPreference: normalized.contactPreference, marketingConsent: normalized.marketingConsent, createdAt: timestamp, lastPurchase, consentAt } },
    { path: `uniqueness/customer-cpf:${cpfIndex}`, data: { ownerId: id, kind: 'CUSTOMER_CPF', value: cpfIndex, version: 1, active: true } },
  ] };
}

// Existing data must be read within the writer transaction. Matching the CPF index
// alone is insufficient: compare the full authenticated contact and metadata.
export function resolveExistingCustomer({ mapped, existing, vaultSettings }) {
  if (!mapped || !Array.isArray(mapped.documents) || mapped.documents.length !== 2 || !/^[a-f0-9]{64}$/.test(mapped.fingerprint || '')) fail();
  if (existing === null) return mapped;
  const desired = mapped.documents[0]?.data;
  if (!desired || !existing || existing.id !== desired.id || existing.cpfIndex !== desired.cpfIndex ||
      existing.revision !== desired.revision || existing.createdAt !== desired.createdAt ||
      existing.consentAt !== desired.consentAt || existing.lastPurchase !== desired.lastPurchase ||
      existing.contactPreference !== desired.contactPreference || existing.marketingConsent !== desired.marketingConsent) fail();
  const vault = createPersonalDataVault(vaultSettings);
  let normalized;
  try { normalized = normalizeCustomer(vault.open('customers', existing.id, existing.contact)); } catch { fail(); }
  const fingerprint = vault.fingerprint(['migration.customer.v1', existing.id, normalized, existing.createdAt, existing.consentAt, existing.lastPurchase]);
  if (fingerprint !== mapped.fingerprint) fail();
  return { ...mapped, documents: mapped.documents.map((doc, index) => index === 0 ? { ...doc, data: { ...desired, contact: existing.contact } } : doc) };
}

// Preserve existing media only with a consistent parent and an exact SHA match.
// This function does not delete or modify the subdocument.
export function resolveExistingMedia({ documents, parentPath, flag, existingParent, existingMedia }) {
  if (!Array.isArray(documents) || !['hasPhoto', 'hasImage'].includes(flag) ||
      typeof parentPath !== 'string' || !(existingParent === null || typeof existingParent === 'object') ||
      !(existingMedia === null || typeof existingMedia === 'object')) fail();
  const parent = documents.find(doc => doc.path === parentPath);
  const childPath = `${parentPath}/media/${flag === 'hasPhoto' ? 'cover' : 'image'}`;
  const child = documents.find(doc => doc.path === childPath);
  if (!parent || typeof parent.data?.[flag] !== 'boolean' || parent.data[flag] !== Boolean(child)) fail();
  if (existingParent === null) { if (existingMedia !== null) fail(); return documents; }
  if (typeof existingParent[flag] !== 'boolean' || existingParent[flag] !== (existingMedia !== null)) fail();
  if (existingMedia !== null) {
    const at = storedTimestamp(existingMedia.updatedAt);
    if (!at) fail();
    const verified = media(existingMedia, at);
    if (child && child.data.sha256 !== verified.sha256) fail();
    if (parentPath.startsWith('products/') && parent.data.coverUrl) fail();
    return documents.filter(doc => doc.path !== childPath).map(doc => doc.path === parentPath ? { ...doc, data: { ...doc.data, [flag]: true } } : doc);
  }
  return documents;
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function storedTimestamp(value) {
  try {
    if (typeof value === 'string') return validTimestamp(value) ? value : null;
    const date = value instanceof Date ? value : value && typeof value.toDate === 'function' ? value.toDate() : null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch { return null; }
}
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

export function mapStockMovementDocuments({ commandId, productId, at, type, quantity, stockBefore, stockAfter, versionBefore, versionAfter, reason, saleId, operatorId }) {
  if (!catalogUuid(commandId) || !catalogUuid(productId) || !catalogUuid(operatorId) || !validTimestamp(at) ||
      !['ENTRADA', 'SAIDA'].includes(type) || !nonnegative(quantity) || quantity === 0 ||
      !nonnegative(stockBefore) || !nonnegative(stockAfter) || !Number.isSafeInteger(versionBefore) || versionBefore < 1 ||
      versionAfter !== versionBefore + 1 || stockAfter !== stockBefore + (type === 'ENTRADA' ? quantity : -quantity) ||
      typeof reason !== 'string' || !reason.trim() || reason.length > 300 || !(saleId === null || catalogUuid(saleId)) ||
      (saleId !== null && (type !== 'SAIDA' || saleId !== commandId))) fail();
  const id = `${commandId}:${productId}`;
  return [{ path: `stockMovements/${id}`, data: { id, commandId, productId, at, type, quantity, stockBefore, stockAfter,
    versionBefore, versionAfter, reason, saleId, operatorId } }];
}

export function mapSaleDocuments({ idempotencyKey, customerId, attendantId, createdAt, paymentMethod, totalCents, items }) {
  if (!catalogUuid(idempotencyKey) || !(customerId === null || catalogUuid(customerId)) || !catalogUuid(attendantId) ||
      !validTimestamp(createdAt) || !['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'].includes(paymentMethod) ||
      !nonnegative(totalCents) || !Array.isArray(items) || !items.length || items.length > 100) fail();
  let total = 0; const seen = new Set();
  const docs = items.map(item => {
    if (!item || !catalogUuid(item.productId) || seen.has(item.productId) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300 ||
        !nonnegative(item.quantity) || item.quantity === 0 || !nonnegative(item.unitPriceCents) || !nonnegative(item.subtotalCents) ||
        !Number.isSafeInteger(item.quantity * item.unitPriceCents) || item.subtotalCents !== item.quantity * item.unitPriceCents ||
        !Number.isSafeInteger(total + item.subtotalCents)) fail();
    total += item.subtotalCents; seen.add(item.productId);
    return { path: `sales/${idempotencyKey}/items/${item.productId}`, data: { productId: item.productId, title: item.title,
      quantity: item.quantity, unitPriceCents: item.unitPriceCents, subtotalCents: item.subtotalCents } };
  });
  if (total !== totalCents) fail();
  return [{ path: `sales/${idempotencyKey}`, data: { id: idempotencyKey, idempotencyKey, customerId, attendantId,
    createdAt, paymentMethod, totalCents, status: 'CONFIRMADA', origin: 'CAIXA_DEV' } }, ...docs];
}