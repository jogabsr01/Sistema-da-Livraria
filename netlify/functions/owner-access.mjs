import { createOwnerAccessHandler } from '../../backend/owner-access.mjs';
export const config = { path: '/api/v1/access/:operation' };
export default createOwnerAccessHandler();
