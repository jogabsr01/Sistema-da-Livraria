import { createCustomerHandler } from '../../backend/customer-handler.mjs';
export default createCustomerHandler();
export const config={path:'/api/v1/customers/*'};
