import { createCatalogHandler } from '../../backend/catalog-handler.mjs';
export const config = { path: '/api/v1/catalog/:operation' };
export default createCatalogHandler();
