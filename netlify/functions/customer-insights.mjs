import { createCustomerInsightsHandler } from '../../backend/customer-insights-handler.mjs';
export default createCustomerInsightsHandler();
export const config={path:'/api/v1/customer-insights/:operation'};
