import { createReportHandler } from '../../backend/report-handler.mjs';
export const config={path:'/api/v1/reports/:operation'};
export default createReportHandler();
