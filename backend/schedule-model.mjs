import { invalidInput } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
export const scheduleInvalid=field=>invalidInput('INVALID_SCHEDULE',field);
export function scheduleDate(v){if(typeof v!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(v)||v<'2020-01-01'||v>'2099-12-31'||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)scheduleInvalid('date');return v;}
export const scheduleTime=(v,field='start')=>{if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))scheduleInvalid(field);return v;};
export function scheduleNotes(v){if(typeof v!=='string')scheduleInvalid();v=v.normalize('NFC').replace(/\r\n?/g,'\n').trim();if(v.length>1000||/[\x00-\x08\x0b-\x1f\x7f]/.test(v))scheduleInvalid();return v;}
export function scheduleRecord(p){if(!p||Array.isArray(p)||JSON.stringify(Object.keys(p).sort())!==JSON.stringify(['date','employeeId','end','notes','start','status'])||!catalogUuid(p.employeeId)||!['RASCUNHO','PUBLICADA'].includes(p.status))scheduleInvalid();const r={employeeId:p.employeeId,date:scheduleDate(p.date),start:scheduleTime(p.start),end:scheduleTime(p.end,'end'),notes:scheduleNotes(p.notes),status:p.status};if(r.end<=r.start)scheduleInvalid('end');return r;}
export function scheduleRange(from,to){scheduleDate(from);scheduleDate(to);if(to<from||(Date.parse(to+'T12:00Z')-Date.parse(from+'T12:00Z'))/86400000>41)scheduleInvalid();return {from,to};}
export function scheduleContentHash(vault,id,r){return vault.fingerprint({type:'schedule.content.v1',id,employeeId:r.employeeId,date:r.date,start:r.start,end:r.end,notes:r.notes});}
