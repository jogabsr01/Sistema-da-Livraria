import { createCheckoutHandler } from '../../backend/checkout-handler.mjs';
export const config = { path: '/api/v1/checkout' };
export default createCheckoutHandler();
