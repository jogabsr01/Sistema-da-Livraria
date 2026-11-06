import { createSessionHandler } from '../../backend/session-handler.mjs';
export const config = { path: '/api/v1/session/revoke-others' };
export default createSessionHandler('revokeOthers');
