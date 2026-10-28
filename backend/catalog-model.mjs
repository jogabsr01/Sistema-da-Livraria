import { invalidInput } from './errors.mjs';
export const catalogUuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const fail = field => invalidInput('INVALID_PRODUCT',field);
export const productFields = ['isbn', 'internalCode', 'title', 'author', 'publisher', 'edition', 'supplier', 'priceCents', 'minimumStock', 'category', 'coverUrl', 'year', 'pages', 'synopsis', 'nicheIds', 'active'];
export function normalizedIsbn(value) {
  if (typeof value !== 'string' || value.length > 30) fail('isbn');
  let isbn = value.replace(/[\s-]/g, '').toUpperCase();
  if (!isbn) return '';
  if (/^\d{9}[\dX]$/.test(isbn)) {
    if ([...isbn].reduce((sum, n, i) => sum + (n === 'X' ? 10 : Number(n)) * (10 - i), 0) % 11) fail('isbn');
    const base = '978' + isbn.slice(0, 9), sum = [...base].reduce((s, n, i) => s + Number(n) * (i % 2 ? 3 : 1), 0);
    isbn = base + ((10 - sum % 10) % 10);
  }
  if (!/^(978|979)\d{10}$/.test(isbn) || [...isbn].reduce((s, n, i) => s + Number(n) * (i % 2 ? 3 : 1), 0) % 10) fail('isbn');
  return isbn;
}
function text(value, max, required = false, field) {
  if (value === undefined) value = '';
  if (typeof value !== 'string') fail(field);
  const normalized = value.trim();
  if (normalized.length > max || required && !normalized || /[\x00-\x08\x0b-\x1f\x7f]/.test(normalized) || /^[=+@-]/.test(normalized)) fail(field);
  return normalized;
}
export function normalizedCover(value) {
  const normalized = text(value, 2000); if (!normalized) return '';
  let url; try { url = new URL(normalized); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.href.length > 2000 || url.hostname.endsWith('.') || !url.hostname.includes('.') ||
      /^(?:[\d.]+|\[.*\])$/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)) fail();
  return url.href;
}
export function normalizeProduct(record, id) {
  if (!catalogUuid(id) || !record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !productFields.includes(key))) fail();
  const isbn = normalizedIsbn(record.isbn ?? '');
  if (!Number.isSafeInteger(record.priceCents)) fail('priceCents');
  let internalCode = text(record.internalCode, 31);
  if (!isbn && !internalCode) internalCode = 'INT' + id.replaceAll('-', '').slice(0, 12).toUpperCase();
  if (isbn ? internalCode !== '' : !/^INT[A-Z0-9]{6,28}$/.test(internalCode)) fail();
  for (const [key, max] of [['priceCents', 100_000_000], ['minimumStock', 1_000_000], ['year', 3000], ['pages', 100000]]) {
    const value = record[key] ?? 0; if (!Number.isSafeInteger(value) || value < 0 || value > max || key === 'year' && value !== 0 && value < 1000) fail(key);
  }
  if (!Array.isArray(record.nicheIds) || !record.nicheIds.length || record.nicheIds.length > 20 || record.nicheIds.some(id => !catalogUuid(id)) || new Set(record.nicheIds).size !== record.nicheIds.length || typeof record.active !== 'boolean') fail();
  return { isbn, internalCode, title: text(record.title, 300, true, 'title'), author: text(record.author, 300), publisher: text(record.publisher, 160),
    edition: text(record.edition, 80), supplier: text(record.supplier, 160), priceCents: record.priceCents, minimumStock: record.minimumStock ?? 0,
    category: text(record.category, 80), coverUrl: normalizedCover(record.coverUrl), year: record.year ?? 0, pages: record.pages ?? 0,
    synopsis: text(record.synopsis, 5000), nicheIds: record.nicheIds.slice().sort(), active: record.active };
}
