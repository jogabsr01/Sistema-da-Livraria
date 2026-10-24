import { createEmailChangeHandler } from '../../backend/email-change-handler.mjs';
export default createEmailChangeHandler();
export const config={path:'/api/v1/email-change/*'};
