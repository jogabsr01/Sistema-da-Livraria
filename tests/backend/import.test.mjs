import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductImport } from '../../backend/import-plan.mjs';
const valid = () => ({ environment: 'dev', schemaVersion: 1, niches: [{ id: 'teste', nome: 'Nicho fictício' }], products: [{ isbn: '9780140328721', titulo: 'Livro fictício', precoCentavos: 3990, estoque: 2, nichos: ['teste'] }] });
test('import preflight returns only counts/hash, never writes or exports customer data', () => {
  const result = validateProductImport(valid());
  assert.equal(result.products, 1); assert.equal(result.writePerformed, false);
  assert.ok(!JSON.stringify(result).includes('Livro fictício'));
});
test('imports reject PROD, customer/sale fields, duplicate IDs, broken links and spreadsheet formulas', () => {
  for (const mutate of [v => { v.environment = 'prod'; }, v => { v.clientes = []; }, v => { v.products.push({ ...v.products[0] }); }, v => { v.products[0].CPF = 'not-allowed'; }, v => { v.products[0].isbn = '9786500000001'; }, v => { v.products[0].estoque = -1; }, v => { v.products[0].precoCentavos = 3.99; }, v => { v.products[0].nichos = ['missing']; }, v => { v.products[0].titulo = '\t=IMPORTXML("bad")'; }]) {
    const value = valid(); mutate(value); assert.throws(() => validateProductImport(value));
  }
});
test('books without barcode require a real internal identifier, not a fabricated ISBN', () => {
  const value = valid(); Object.assign(value.products[0], { semCodigo: true, isbn: 'INTABC123ABC123' });
  assert.equal(validateProductImport(value).products, 1);
  value.products[0].isbn = '9780140328721'; assert.throws(() => validateProductImport(value));
});
