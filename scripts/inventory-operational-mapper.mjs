import { createHash } from 'node:crypto';
import { analyzeFixtureRecords } from './inventory-fixture-records.mjs';
import { validateOperationalImport } from '../backend/import-operational-plan.mjs';
import { resolveImportMetadata, assignImportMovementVersions } from '../backend/import-context-defaults.mjs';
import { catalogUuid } from '../backend/catalog-model.mjs';

const fail = code => { throw new Error(code); };
const blank = v => v === null || v === '';
const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const allowedErrors = new Set(['OPERATIONAL_IMPORT_INVALID', 'OPERATIONAL_PRODUCTS_INVALID', 'OPERATIONAL_CUSTOMERS_INVALID', 'OPERATIONAL_CUSTOMER_CPF_DUPLICATE', 'OPERATIONAL_CONSENT_INVALID', 'OPERATIONAL_SALES_INVALID', 'OPERATIONAL_SALE_ITEMS_INVALID', 'OPERATIONAL_SALE_TOTAL_INVALID', 'OPERATIONAL_MOVEMENT_INVALID', 'OPERATIONAL_STOCK_CHAIN_INVALID', 'OPERATIONAL_SALE_MOVEMENT_INVALID', 'OPERATIONAL_STOCK_CLOSING_INVALID']);

// Returns only validation counts: the candidate contains PII and must never leave this scope.
export function validateMappedOperationalFixture(bytes, schema) {
  analyzeFixtureRecords(bytes, schema);
  const fixture = JSON.parse(bytes.toString('utf8'));
  const rows = Object.fromEntries(fixture.sheets.map(sheet => [sheet.name, sheet.rows.filter(row => !row.every(blank))
    .map(row => Object.fromEntries(sheet.headers.map((header, i) => [header, row[i]])))]));
  // An explicit fixture-only assertion is required; a first movement cannot prove history completeness.
  const opening = fixture.operationalOpeningStocks;
  if (!opening || opening.completeHistory !== true || !Array.isArray(opening.products)) fail('MAPPING_OPENING_EVIDENCE_REQUIRED');
  const openings = new Map();
  for (const entry of opening.products) {
    if (!entry || typeof entry.id !== 'string' || !Number.isSafeInteger(entry.stock) || entry.stock < 0 || openings.has(entry.id)) fail('MAPPING_OPENING_EVIDENCE_INVALID');
    openings.set(entry.id, entry.stock);
  }
  if (openings.size !== rows.Produtos.length || rows.Produtos.some(p => !openings.has(p.ID_Produto))) fail('MAPPING_OPENING_EVIDENCE_INVALID');
  const products = rows.Produtos.map(p => ({ id: p.ID_Produto, openingStock: openings.get(p.ID_Produto), closingStock: p.Estoque_Atual }));
  const customers = rows.Clientes.map(c => ({ id: c.ID_Cliente, record: {
    name: c.Nome, cpf: c.CPF, email: c.Email ?? '', phone: c.Whatsapp ?? '', postalCode: c.CEP ?? '', street: c.Logradouro ?? '',
    number: c.Numero ?? '', complement: c.Complemento ?? '', district: c.Bairro ?? '', city: c.Cidade ?? '', state: c.UF ?? '',
    contactPreference: c.Preferencia_Contato, marketingConsent: c.Consentimento_Marketing,
  }, consentAt: blank(c.Data_Consentimento) ? null : c.Data_Consentimento }));
  const saleIds = new Set();
  const sales = rows.Vendas.map(s => {
    if (s.Status !== 'CONFIRMADA' || blank(s.Idempotency_Key)) fail('MAPPING_SALE_UNSUPPORTED');
    if (saleIds.has(s.ID_Venda)) fail('MAPPING_DUPLICATE_SALE');
    saleIds.add(s.ID_Venda);
    return { id: s.ID_Venda, idempotencyKey: s.Idempotency_Key, customerId: blank(s.ID_Cliente) ? null : s.ID_Cliente,
      totalCents: s.Valor_Total, items: [] };
  });
  const saleMap = new Map(sales.map(sale => [sale.id, sale]));
  for (const item of rows.Itens_Venda) {
    const sale = saleMap.get(item.ID_Venda);
    if (!sale) fail('MAPPING_ORPHAN_ITEM');
    sale.items.push({ productId: item.ID_Produto, quantity: item.Quantidade, unitPriceCents: item.Preco_Unitario, subtotalCents: item.Subtotal });
  }
  const sourceIds = new Set(), timestamps = new Set();
  const ordered = rows.Movimentacoes_Estoque.map(m => {
    if (typeof m.ID_Movimentacao !== 'string' || !m.ID_Movimentacao || sourceIds.has(m.ID_Movimentacao)) fail('MAPPING_MOVEMENT_ID_INVALID');
    sourceIds.add(m.ID_Movimentacao);
    if (!iso(m.Data_Hora)) fail('MAPPING_MOVEMENT_TIME_INVALID');
    const orderKey = JSON.stringify([m.ID_Produto, m.Data_Hora]);
    if (timestamps.has(orderKey)) fail('MAPPING_MOVEMENT_ORDER_AMBIGUOUS');
    timestamps.add(orderKey);
    return m;
  }).sort((a, b) => a.Data_Hora.localeCompare(b.Data_Hora));
  const movements = ordered.map(m => ({ id: createHash('sha256').update(m.ID_Movimentacao).digest('hex'), productId: m.ID_Produto,
    type: m.Tipo, quantity: m.Quantidade, stockBefore: m.Saldo_Anterior, stockAfter: m.Saldo_Posterior,
    saleId: blank(m.ID_Venda) ? null : m.ID_Venda }));
  let result;
  try { result = validateOperationalImport({ environment: 'dev', schemaVersion: 1, products, customers, sales, movements }); }
  catch (error) { fail(allowedErrors.has(error?.message) ? error.message : 'OPERATIONAL_IMPORT_INVALID'); }
  if (!result || result.writePerformed !== false) fail('OPERATIONAL_WRITE_CONTRACT_VIOLATION');
  return result;
}

// Explicitly sensitive in-memory projection: never serialize or log this result.
// This is not a Firestore document payload and does not authorize writes.
export function projectOperationalFixture(bytes, schema, { syntheticActorId, allowSyntheticActor = false } = {}) {
  const summary = validateMappedOperationalFixture(bytes, schema);
  const fixture = JSON.parse(bytes.toString('utf8'));
  const rows = Object.fromEntries(fixture.sheets.map(sheet => [sheet.name, sheet.rows.filter(row => !row.every(blank))
    .map(row => Object.fromEntries(sheet.headers.map((header, index) => [header, row[index]])))]));
  const opening = new Map(fixture.operationalOpeningStocks.products.map(item => [item.id, item.stock]));
  const requireUuid = value => { if (!catalogUuid(value)) fail('MAPPING_UUID_REQUIRED'); return value; };
  const byId = new Map(rows.Vendas.map(sale => [sale.ID_Venda, sale]));
  const metadata = (actor, version, newDocument) => resolveImportMetadata({ sourceActorId: actor, sourceVersion: version,
    syntheticActorId, allowSyntheticActor, isNewDocument: newDocument });
  const products = rows.Produtos.map(product => ({ source: product, id: requireUuid(product.ID_Produto), openingStock: opening.get(product.ID_Produto),
    metadata: metadata(product.Criado_Por, product.Versao_Registro, true) }));
  const niches = rows.Nichos.map(niche => ({ source: niche, id: requireUuid(niche.ID_Nicho), metadata: metadata(niche.Criado_Por, null, true) }));
  const customers = rows.Clientes.map(customer => ({ id: requireUuid(customer.ID_Cliente), source: customer }));
  const sales = rows.Vendas.map(sale => ({ source: sale, id: requireUuid(sale.Idempotency_Key), sourceSaleId: sale.ID_Venda,
    metadata: metadata(sale.ID_Atendente, null, true), items: rows.Itens_Venda.filter(item => item.ID_Venda === sale.ID_Venda)
      .map(item => ({ ...item, ID_Produto: requireUuid(item.ID_Produto) })) }));
  const movements = [];
  for (const product of products) {
    const source = rows.Movimentacoes_Estoque.filter(item => item.ID_Produto === product.id).sort((a, b) => a.Data_Hora.localeCompare(b.Data_Hora));
    const chain = assignImportMovementVersions({ completeHistory: fixture.operationalOpeningStocks.completeHistory,
      openingStock: product.openingStock, movements: source.map(item => ({ type: item.Tipo, quantity: item.Quantidade,
        stockBefore: item.Saldo_Anterior, stockAfter: item.Saldo_Posterior })) });
    if (chain.length && product.metadata.version < chain[chain.length - 1].versionAfter) fail('MAPPING_PRODUCT_VERSION_CONFLICT');
    source.forEach((item, index) => {
      const sale = blank(item.ID_Venda) ? null : byId.get(item.ID_Venda);
      if (!blank(item.ID_Venda) && !sale) fail('MAPPING_ORPHAN_ITEM');
      movements.push({ source: item, saleId: sale ? requireUuid(sale.Idempotency_Key) : null,
        metadata: metadata(item.ID_Usuario, null, true), versionBefore: chain[index].versionBefore,
        versionAfter: chain[index].versionAfter, versionProvenance: chain[index].versionProvenance });
    });
  }
  return { summary, niches, products, customers, movements, sales, writePerformed: false };
}