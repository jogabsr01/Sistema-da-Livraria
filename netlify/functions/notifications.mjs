import { createNotificationHandler } from '../../backend/notification-handler.mjs';
export const config = { path: '/api/v1/notifications/:operation' };
export default createNotificationHandler();
