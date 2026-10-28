import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { normalizeCpf,staffText } from './staff-model.mjs';
export const customerInvalid=field=>{const error=new ApiError(400,'INVALID_CUSTOMER');if(['cpf','email','phone','name','postalCode','state'].includes(field))error.field=field;throw error;};
const fields=['name','cpf','email','phone','postalCode','street','number','complement','district','city','state','contactPreference','marketingConsent'];
export function normalizeCustomer(input){
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))customerInvalid();
  const out={};for(const [key,max] of [['name',160],['email',254],['phone',20],['postalCode',9],['street',200],['number',30],['complement',100],['district',100],['city',100],['state',2]]){try{out[key]=staffText(input[key]??'',max,key==='name');}catch{customerInvalid(key);}}
  out.cpf=normalizeCpf(input.cpf);out.email=out.email.toLowerCase();out.phone=out.phone.replace(/[\s()+-]/g,'');out.postalCode=out.postalCode.replace('-','');out.state=out.state.toUpperCase();
  if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))customerInvalid('email');
  if(out.phone&&!/^\d{10,15}$/.test(out.phone))customerInvalid('phone');
  if(out.postalCode&&!/^\d{8}$/.test(out.postalCode))customerInvalid('postalCode');
  if(out.state&&!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(out.state))customerInvalid('state');
  if(out.phone&&!/^\d{10,15}$/.test(out.phone)||out.postalCode&&!/^\d{8}$/.test(out.postalCode)||out.state&&!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(out.state)||typeof input.marketingConsent!=='boolean'||!['NONE','WHATSAPP','EMAIL'].includes(input.contactPreference)||input.contactPreference==='EMAIL'&&!out.email||input.contactPreference==='WHATSAPP'&&!out.phone||input.marketingConsent&&input.contactPreference==='NONE')customerInvalid();
  return {name:out.name,cpf:out.cpf,email:out.email,phone:out.phone,postalCode:out.postalCode,street:out.street,number:out.number,complement:out.complement,district:out.district,city:out.city,state:out.state,contactPreference:input.contactPreference,marketingConsent:input.marketingConsent};
 }catch(e){if(e instanceof ApiError&&e.code==='INVALID_CUSTOMER')throw e;customerInvalid(e.field);}
}
export function normalizeCustomerCommand(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='commandId,expectedRevision,id,record'||!catalogUuid(input.commandId)||!catalogUuid(input.id)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>1000000)customerInvalid();
 return {commandId:input.commandId,id:input.id,expectedRevision:input.expectedRevision,record:normalizeCustomer(input.record)};
}
export function customerDto(row,vault){
 if(!row||!catalogUuid(row.id)||!Number.isSafeInteger(row.revision)||row.revision<1||!['createdAt','lastPurchase','consentAt'].every(k=>typeof row[k]==='string'&&(row[k]===''||Number.isFinite(Date.parse(row[k])))))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
 let p;try{p=normalizeCustomer(vault.open('customers',row.id,row.contact));}catch(e){if(e instanceof ApiError&&e.status===400)throw new ApiError(502,'UPSTREAM_UNTRUSTED');throw e;}const {cpf,...rest}=p;
 if(p.marketingConsent!==row.marketingConsent||p.contactPreference!==row.contactPreference)throw new ApiError(502,'UPSTREAM_UNTRUSTED');
 return {id:row.id,revision:row.revision,...rest,cpfMasked:'***.'+cpf.slice(3,6)+'.'+cpf.slice(6,9)+'-**',createdAt:row.createdAt,lastPurchase:row.lastPurchase,consentAt:row.consentAt};
}
