import { createAuditHandler } from '../../backend/audit-handler.mjs';
export const config={path:'/api/v1/audit/:operation'};
export default createAuditHandler();
