import { createKeyManagementHandler } from '../../backend/key-management-handler.mjs';
export const config={path:'/api/v1/keys/:operation'};
export default createKeyManagementHandler();
