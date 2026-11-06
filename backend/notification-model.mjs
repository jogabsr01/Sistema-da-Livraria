import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
const invalid = () => { throw new ApiError(502, 'UPSTREAM_UNTRUSTED'); };
const count = (n, max = 5000) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const date = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const text = (s, max) => typeof s === 'string' && s.length <= max && s === s.trim() && !/[\x00-\x1f\x7f]/.test(s);
export function validateNotificationResponse(operation, data, payload, requestId) {
  if (operation === 'read' || operation === 'state') {
    const key = operation === 'read' ? 'read' : 'accepted'; if (data?.[key] !== true) invalid(); return { [key]: true };
  }
  if (operation === 'summary') {
    if (!count(data?.total) || !count(data.unread) || data.unread > data.total) invalid(); return { total: data.total, unread: data.unread };
  }
  if (operation === 'list') {
    if (!count(data?.total) || !Array.isArray(data.items) || data.items.length > 25 || data.items.length > data.total ||
        data.nextOffset !== null && (data.nextOffset !== payload.offset + data.items.length || data.nextOffset >= data.total)) invalid();
    const ids = new Set();
    const items = data.items.map(n => {
      if(n?.type==='MAINTENANCE_COMPLETED'){
        if(!catalogUuid(n.id)||ids.has(n.id)||!catalogUuid(n.referenceId)||n.priority!=='MEDIA'||!text(n.title,300)||!n.title||!text(n.message,300)||!n.message||n.state!=='ABERTA'||!date(n.createdAt)||n.resolvedAt!==null||typeof n.read!=='boolean'||!payload.history&&n.read)invalid();ids.add(n.id);return Object.fromEntries(['id','referenceId','type','priority','title','message','state','createdAt','resolvedAt','read'].map(k=>[k,n[k]]));
      }
      if(n&&['SCHEDULE_PUBLISHED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED'].includes(n.type)){
        if(!catalogUuid(n.recipientId)||!catalogUuid(n.id)||ids.has(n.id)||!catalogUuid(n.scheduleId)||n.priority!=='MEDIA'||!text(n.title,300)||!n.title||!text(n.message,300)||n.state!=='ABERTA'||!date(n.createdAt)||n.resolvedAt!==null||typeof n.read!=='boolean'||!/^20\d\d-\d{2}-\d{2}$/.test(n.date)||!Number.isFinite(Date.parse(n.date+'T12:00Z'))||new Date(n.date+'T12:00Z').toISOString().slice(0,10)!==n.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.end)||n.end<=n.start||!payload.history&&n.read)invalid();ids.add(n.id);return Object.fromEntries(['recipientId','id','scheduleId','type','priority','title','message','state','createdAt','resolvedAt','read','date','start','end'].map(k=>[k,n[k]]));
      }
      if (!n || !catalogUuid(n.id) || ids.has(n.id) || !catalogUuid(n.productId) || !['STOCK_ZERO','STOCK_LOW'].includes(n.type) || !['ALTA','MEDIA'].includes(n.priority) ||
          n.priority !== (n.type === 'STOCK_ZERO' ? 'ALTA' : 'MEDIA') || !text(n.title, 300) || !n.title || !['ABERTA','EM_ATENDIMENTO','RESOLVIDA'].includes(n.state) || !date(n.createdAt)) invalid();
      if (n.state === 'RESOLVIDA' ? !date(n.resolvedAt) : n.resolvedAt !== null) invalid();
      if (typeof n.read !== 'boolean' || !count(n.stock, Number.MAX_SAFE_INTEGER) || !count(n.minimumStock, 1000000) || !payload.history && n.state === 'RESOLVIDA') invalid();
      ids.add(n.id); return Object.fromEntries(['id','productId','type','priority','title','state','createdAt','resolvedAt','read','stock','minimumStock'].map(key => [key,n[key]]));
    }); return { items, total: data.total, nextOffset: data.nextOffset };
  }
  if (operation !== 'report' || !data || data.reportId !== requestId || !date(data.generatedAt) || data.scope !== payload.scope || data.supplier !== payload.supplier ||
      !count(data.totalBooks) || !count(data.missingSupplier) || !count(data.suggestedUnits, 5000000000) || !Array.isArray(data.groups) || data.groups.length > 5000) invalid();
  let books = 0, units = 0, missing = 0; const ids = new Set(), suppliers = new Set();
  const groups = data.groups.map(group => {
    if (!group || !text(group.supplier, 160) || !Array.isArray(group.items) || !group.items.length || group.items.length > 5000) invalid();
    const key = group.supplier.normalize('NFC').toLowerCase(); if (suppliers.has(key)) invalid(); suppliers.add(key);
    if (payload.supplier !== null && key !== payload.supplier.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase()) invalid();
    const items = group.items.map(item => {
      if (!item || !catalogUuid(item.id) || ids.has(item.id) || !text(item.title,300) || !item.title || !text(item.isbn,13) || !text(item.internalCode,31) ||
          !count(item.stock, 1000000) || !count(item.minimumStock,1000000) || item.stock !== 0 && !(payload.scope === 'low' && item.stock < item.minimumStock) ||
          item.suggestedQuantity !== Math.max(1,item.minimumStock-item.stock) || !['ABERTA','EM_ATENDIMENTO'].includes(item.alertState) || !date(item.since)) invalid();
      ids.add(item.id); books++; units += item.suggestedQuantity; if (!group.supplier) missing++;
      return Object.fromEntries(['id','title','isbn','internalCode','stock','minimumStock','suggestedQuantity','alertState','since'].map(key => [key,item[key]]));
    }); return { supplier: group.supplier, items };
  });
  if (books !== data.totalBooks || units !== data.suggestedUnits || missing !== data.missingSupplier) invalid();
  return { reportId:data.reportId, generatedAt:data.generatedAt, scope:data.scope, supplier:data.supplier, groups, totalBooks:books, suggestedUnits:units, missingSupplier:missing };
}
