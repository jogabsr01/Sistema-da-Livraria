import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
export const invalidAudit=()=>{throw new ApiError(400,'INVALID_AUDIT');};
export const auditToken=v=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,140}$/.test(v);
export const auditHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const auditTime=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function auditFilters(p){
 const fields=['from','to','employeeId','operation','productId','saleId','result'];
 if(!p||Array.isArray(p)||Object.keys(p).sort().join()!==fields.sort().join()||!auditTime(p.from)||!auditTime(p.to)||p.to<p.from||Date.parse(p.to)-Date.parse(p.from)>366*86400000||['employeeId','operation','productId','saleId','result'].some(k=>typeof p[k]!=='string'))invalidAudit();
 if(p.employeeId&&!catalogUuid(p.employeeId)&&!['SYSTEM_STOCK','SYSTEM_AUTH'].includes(p.employeeId)||['productId','saleId'].some(k=>p[k]&&!catalogUuid(p[k]))||['operation','result'].some(k=>p[k]&&!/^[A-Z_]{1,60}$/.test(p[k])))invalidAudit();
 return Object.fromEntries(['from','to','employeeId','operation','productId','saleId','result'].map(k=>[k,p[k]]));
}
// A closed disclosure schema, also applied after the trusted service boundary.
export function auditSafeDetail(value,operation){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const out={};
 const numbers=['version','revision','stock','quantity','totalCents','authorizationVersion','notifications','count','sourceCount','order','revokedSessions','retryAfterSeconds','priceCents','minimumStock','year','pages'];
 const flags=['otherSessionsRevoked','avatarChanged','emailVerified','reasonRecorded','reenrollmentRequired','found','marketingConsent','imageChanged','descriptionChanged','notesChanged','active','hasPhoto','hasExternalCover','coverChanged','synopsisChanged'];
 for(const k of numbers)if(Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=1e12)out[k]=value[k];
 for(const k of flags)if(typeof value[k]==='boolean')out[k]=value[k];
 for(const k of ['employeeId','customerId','productId','saleId'])if(catalogUuid(value[k]))out[k]=value[k];
 for(const k of ['role','status','paymentMethod','code','state','reason','phase','reportType'])if(typeof value[k]==='string'&&/^[A-Z_]{1,60}$/.test(value[k]))out[k]=value[k];
 for(const k of ['date','start','end',...(/^NICHE_/.test(operation||'')?['color','name']:[])])if(typeof value[k]==='string'&&value[k].length<=100&&!/[\x00-\x1f\x7f]/.test(value[k]))out[k]=value[k];
 for(const [key,fields]of [['items',['productId','title','quantity','unitPriceCents','subtotalCents']],['lines',['id','expectedVersion','before','after']]]){
  if(Array.isArray(value[key])&&value[key].length<=100)out[key]=value[key].map(v=>Object.fromEntries(fields.filter(k=>['id','productId'].includes(k)?catalogUuid(v?.[k]):k==='title'?typeof v?.[k]==='string'&&v[k].length<=300&&!/[\x00-\x1f\x7f]/.test(v[k]):Number.isSafeInteger(v?.[k])&&v[k]>=0&&v[k]<=1e12).map(k=>[k,v[k]])));
 }
 if(/^PRODUCT_/.test(operation||'')){for(const k of ['isbn','internalCode','title','author','publisher','edition','supplier','category'])if(typeof value[k]==='string'&&value[k].length<=300&&!/[\x00-\x1f\x7f]/.test(value[k]))out[k]=value[k];if(Array.isArray(value.nicheIds)&&value.nicheIds.length<=20&&value.nicheIds.every(catalogUuid))out.nicheIds=[...value.nicheIds];}
 return out;
}
export function matchesAudit(r,f){return r.at>=f.from&&r.at<=f.to&&(!f.employeeId||r.actorId===f.employeeId)&&(!f.operation||r.operation===f.operation)&&(!f.result||r.result===f.result)&&(!f.saleId||r.entity==='Vendas'&&r.entityId===f.saleId)&&(!f.productId||r.entity==='Produtos'&&r.entityId===f.productId||[r.before,r.after].some(d=>d.productId===f.productId||['items','lines'].some(k=>d[k]?.some(l=>(l.productId||l.id)===f.productId))));}
export function validateAuditData(data,op,p){
 const bad=()=>{throw new ApiError(502,'UPSTREAM_UNTRUSTED');};
 if(!data||!auditHash(data.snapshot)||!Number.isSafeInteger(data.total)||data.total<0||data.total>5000||!Number.isSafeInteger(data.sourceCount)||data.sourceCount<0||data.sourceCount>5000||data.total>data.sourceCount||!Array.isArray(data.items)||data.items.length>(op==='export'?500:25)||!auditTime(data.generatedAt)||!Array.isArray(data.people)||data.people.length>5000)bad();
 if(p.snapshot&&data.snapshot!==p.snapshot)bad();
 const ids=new Set();const items=data.items.map(r=>{
  if(!r||!auditToken(r.id)||ids.has(r.id)||!auditTime(r.at)||!auditToken(r.actorId)||(['SYSTEM_STOCK','SYSTEM_AUTH'].includes(r.actorId)?r.role!=='SYSTEM':r.role==='SYSTEM')||!['ADMIN','SUPER_ADMIN','ATENDENTE','SYSTEM'].includes(r.role)||!auditToken(r.operation)||!auditToken(r.entity)||r.entityId!==''&&!auditToken(r.entityId)||!auditToken(r.result)||!auditToken(r.requestId)||typeof r.detailsOmitted!=='boolean')bad();
  ids.add(r.id);const clean={id:r.id,at:r.at,actorId:r.actorId,role:r.role,operation:r.operation,entity:r.entity,entityId:r.entityId,result:r.result,requestId:r.requestId,before:auditSafeDetail(r.before,r.operation),after:auditSafeDetail(r.after,r.operation),detailsOmitted:r.detailsOmitted};
  if(JSON.stringify(clean.before)!==JSON.stringify(r.before)||JSON.stringify(clean.after)!==JSON.stringify(r.after)||!matchesAudit(clean,p.filters))bad();return clean;
 });
 for(let i=1;i<items.length;i++)if(items[i-1].at<items[i].at||items[i-1].at===items[i].at&&items[i-1].id>items[i].id)bad();
 const offset=op==='export'?0:p.offset;
 if(items.length!==Math.min(op==='export'?data.total:25,Math.max(0,data.total-offset))||op==='export'&&data.total>500||op==='list'&&data.nextOffset!==(offset+items.length<data.total?offset+items.length:null))bad();
 const peopleIds=new Set();for(const person of data.people){if(!person||!auditToken(person.id)||peopleIds.has(person.id)||typeof person.owner!=='boolean'||typeof person.missing!=='boolean'||typeof person.contact!=='string')bad();peopleIds.add(person.id);}
 if(items.some(r=>!peopleIds.has(r.actorId)))bad();
 if(!Array.isArray(data.operations)||!Array.isArray(data.results)||data.operations.length>500||data.results.length>100||data.operations.some(v=>!auditToken(v))||data.results.some(v=>!auditToken(v)))bad();
 return {...data,items};
}
