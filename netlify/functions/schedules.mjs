import { createScheduleHandler } from '../../backend/schedule-handler.mjs';
export default createScheduleHandler();
export const config={path:'/api/v1/schedules/*'};
