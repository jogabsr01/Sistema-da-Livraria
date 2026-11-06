import { createHash } from 'node:crypto';
const productFields = new Set(['isbn', 'semCodigo', 'titulo', 'autor', 'editora', 'edicao', 'fornecedor', 'precoCentavos', 'estoque', 'categoria', 'nichos', 'capaUrl', 'capaFonte', 'anoPublicacao', 'numeroPaginas', 'descricao']);
function invalid(code) { throw new Error(code); }
function validIsbn(value) {
  if (/^\d{13}$/.test(value) && /^(978|979)/.test(value)) return [...value].reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 3 : 1), 0) % 10 === 0;
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, n, i) => sum + (n === 'X' ? 10 : Number(n)) * (10 - i), 0) % 11 === 0;
  return false;
}
export function validateProductImport(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['environment', 'schemaVersion', 'products', 'niches'].includes(k)) || value.environment !== 'dev' || value.schemaVersion !== 1 || !Array.isArray(value.products) || !Array.isArray(value.niches) || value.products.length > 10_000 || value.niches.length > 1000) invalid('IMPORT_INVALID');
  const niches = new Set();
  for (const n of value.niches) {
    if (!n || Object.keys(n).some(k => !['id', 'nome'].includes(k)) || typeof n.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(n.id) || typeof n.nome !== 'string' || !n.nome.trim() || niches.has(n.id)) invalid('IMPORT_NICHES_INVALID');
    niches.add(n.id);
  }
  const ids = new Set();
  for (const p of value.products) {
    if (!p || (p.semCodigo !== undefined && typeof p.semCodigo !== 'boolean') || Object.keys(p).some(k => !productFields.has(k)) || typeof p.isbn !== 'string' || typeof p.titulo !== 'string' || !p.titulo.trim() || !Number.isSafeInteger(p.precoCentavos) || p.precoCentavos < 0 || !Number.isSafeInteger(p.estoque) || p.estoque < 0 || !Array.isArray(p.nichos) || !p.nichos.length || new Set(p.nichos).size !== p.nichos.length || p.nichos.some(id => !niches.has(id))) invalid('IMPORT_PRODUCT_INVALID');
    if (p.semCodigo ? !/^INT[A-Z0-9]{6,28}$/.test(p.isbn) : !validIsbn(p.isbn)) invalid('IMPORT_IDENTIFIER_INVALID');
    if (ids.has(p.isbn)) invalid('IMPORT_DUPLICATE'); ids.add(p.isbn);
    for (const field of Object.values(p)) if (typeof field === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(field)) invalid('IMPORT_FORMULA_REVIEW_REQUIRED');
  }
  for (const n of value.niches) if (/^[\s\u0000-\u001f]*[=+@-]/.test(n.nome)) invalid('IMPORT_FORMULA_REVIEW_REQUIRED');
  return { environment: 'dev', schemaVersion: 1, products: ids.size, niches: niches.size,
    sourceSha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'), writePerformed: false };
}
