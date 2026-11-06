import { projectOperationalFixture } from '../scripts/inventory-operational-mapper.mjs';
import { resolveHistoricalSaleTitles } from './import-context-defaults.mjs';
import { mapNicheDocuments, mapProductDocuments, mapCustomerDocuments, mapStockMovementDocuments, mapSaleDocuments } from './firestore-document-mapper.mjs';

const fail = () => { throw Error('FIRESTORE_BUNDLE_INVALID'); };
const empty = value => value === null || value === '';
const optional = value => empty(value) ? '' : value;

// Sensitive in-memory result. It is not authorization to write, nor proof that
// synthetic historical snapshots or source identity are authentic.
export function validateFirestoreBundle(bytes, schema, context = {}) {
  try {
    const { syntheticActorId, vaultSettings, media, historicalSales, movementCommandIds } = context;
    if (!media || !Array.isArray(media.niches) || !Array.isArray(media.products) ||
        !Array.isArray(historicalSales) || !Array.isArray(movementCommandIds)) fail();
    const projection = projectOperationalFixture(bytes, schema, { syntheticActorId, allowSyntheticActor: true });
    const domains = { niches: [], products: [], customers: [], stockMovements: [], sales: [] };
    const paths = new Set();
    const append = (domain, id, documents, fingerprint = null) => {
      if (documents.length > 99) fail(); // one additional checkpoint write
      for (const document of documents) {
        const parts = document.path.split('/');
        if (parts.length % 2 || parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 1500) || paths.has(document.path)) fail();
        paths.add(document.path);
      }
      domains[domain].push({ id, documents, ...(fingerprint === null ? {} : { fingerprint }) });
    };
    const mediaMap = (entries, expected) => {
      const map = new Map();
      for (const entry of entries) {
        if (!entry || map.has(entry.id) || !Object.hasOwn(entry, 'value')) fail();
        map.set(entry.id, entry.value);
      }
      if (map.size !== expected.length || expected.some(item => !map.has(item.id))) fail();
      return map;
    };
    const nicheMedia = mediaMap(media.niches, projection.niches), productMedia = mediaMap(media.products, projection.products);
    const niches = new Set(projection.niches.map(item => item.id));
    const products = new Set(projection.products.map(item => item.id));
    const customers = new Set(projection.customers.map(item => item.id));
    for (const n of projection.niches) {
      const s = n.source;
      if (!empty(s.Imagem_Drive_ID) && nicheMedia.get(n.id) === null) fail();
      append('niches', n.id, mapNicheDocuments({ id: n.id, actorId: n.metadata.actorId, version: n.metadata.version,
        timestamp: s.Criado_Em, record: { name: s.Nome, description: optional(s.Descricao), color: s.Cor_Destaque,
          order: s.Ordem_Exibicao, active: s.Ativo }, image: nicheMedia.get(n.id) }));
    }
    for (const p of projection.products) {
      const s = p.source;
      if (!empty(s.Capa_Drive_ID) && productMedia.get(p.id) === null) fail();
      if (p.nicheIds.some(id => !niches.has(id))) fail();
      // The mapper currently represents a single created/updated timestamp and actor.
      if ((!empty(s.Atualizado_Em) && s.Atualizado_Em !== s.Criado_Em) ||
          (!empty(s.Atualizado_Por) && s.Atualizado_Por !== p.metadata.actorId)) fail();
      append('products', p.id, mapProductDocuments({ id: p.id, actorId: p.metadata.actorId, version: p.metadata.version,
        timestamp: s.Criado_Em, stock: s.Estoque_Atual, cover: productMedia.get(p.id), record: {
          isbn: optional(s.ISBN), internalCode: optional(s.Codigo_Interno), title: s.Titulo, author: optional(s.Autor),
          publisher: optional(s.Editora), edition: optional(s.Edicao), supplier: optional(s.Fornecedor), priceCents: s.Preco_Venda,
          minimumStock: s.Estoque_Minimo, category: optional(s.Categoria), coverUrl: optional(s.Capa_URL_Externa),
          year: s.Ano_Publicacao, pages: s.Paginas, synopsis: optional(s.Sinopse), nicheIds: p.nicheIds, active: s.Ativo } }));
    }
    for (const c of projection.customers) {
      const s = c.source;
      const mapped = mapCustomerDocuments({ id: c.id, timestamp: s.Data_Cadastro, consentAt: optional(s.Data_Consentimento),
        lastPurchase: optional(s.Ultima_Compra), vaultSettings, record: { name: s.Nome, cpf: s.CPF, email: optional(s.Email),
          phone: optional(s.Whatsapp), postalCode: optional(s.CEP), street: optional(s.Logradouro), number: optional(s.Numero),
          complement: optional(s.Complemento), district: optional(s.Bairro), city: optional(s.Cidade), state: optional(s.UF),
          contactPreference: s.Preferencia_Contato, marketingConsent: s.Consentimento_Marketing } });
      append('customers', c.id, mapped.documents, mapped.fingerprint);
    }
    const commands = new Map();
    for (const item of movementCommandIds) {
      if (!item || commands.has(item.sourceId)) fail();
      commands.set(item.sourceId, item.commandId);
    }
    if (commands.size !== projection.movements.length) fail();
    for (const m of projection.movements) {
      const s = m.source;
      if (!commands.has(s.ID_Movimentacao) || !products.has(s.ID_Produto)) fail();
      append('stockMovements', s.ID_Movimentacao, mapStockMovementDocuments({ commandId: commands.get(s.ID_Movimentacao),
        productId: s.ID_Produto, at: s.Data_Hora, type: s.Tipo, quantity: s.Quantidade, stockBefore: s.Saldo_Anterior,
        stockAfter: s.Saldo_Posterior, versionBefore: m.versionBefore, versionAfter: m.versionAfter,
        reason: s.Motivo, saleId: m.saleId, operatorId: m.metadata.actorId }));
    }
    if (historicalSales.length !== projection.sales.length) fail();
    for (const sale of projection.sales) {
      const s = sale.source, customerId = empty(s.ID_Cliente) ? null : s.ID_Cliente;
      if (customerId !== null && !customers.has(customerId)) fail();
      const items = sale.items.map(i => ({ productId: i.ID_Produto, quantity: i.Quantidade,
        unitPriceCents: i.Preco_Unitario, subtotalCents: i.Subtotal }));
      if (items.some(i => !products.has(i.productId))) fail();
      const resolved = resolveHistoricalSaleTitles({ saleId: sale.id, items, snapshots: historicalSales });
      append('sales', sale.id, mapSaleDocuments({ idempotencyKey: sale.id, customerId, attendantId: sale.metadata.actorId,
        createdAt: s.Data_Hora, paymentMethod: s.Forma_Pagamento, totalCents: s.Valor_Total, items: resolved }));
    }
    for (const groups of Object.values(domains)) groups.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { domains, writePerformed: false };
  } catch { fail(); }
}