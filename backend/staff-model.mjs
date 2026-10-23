import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
export const staffInvalid=()=>{throw new ApiError(400,'INVALID_STAFF');};
export function staffText(value,max,required=false){if(typeof value!=='string')staffInvalid();value=value.normalize('NFC').trim();if(value.length>max||required&&!value||/[\x00-\x1f\x7f]/.test(value)||/^[=+@-]/.test(value))staffInvalid();return value;}
export function normalizeCpf(value){if(typeof value!=='string'||value.length>20)staffInvalid();const cpf=value.replace(/[.\-\s]/g,'');if(!/^\d{11}$/.test(cpf)||/^(\d)\1+$/.test(cpf))staffInvalid();for(let n=9;n<11;n++){let sum=0;for(let i=0;i<n;i++)sum+=Number(cpf[i])*(n+1-i);if(Number(cpf[n])!==((sum*10)%11)%10)staffInvalid();}return cpf;}
export function normalizeStaffContact(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(Object.keys(input).sort())!==JSON.stringify(['cpf','email','name','phone']))staffInvalid();
 const name=staffText(input.name,160,true),cpf=normalizeCpf(input.cpf),email=staffText(input.email,254,true).toLowerCase(),phone=staffText(input.phone,20).replace(/[\s()+-]/g,'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone&&!/^\d{10,15}$/.test(phone))staffInvalid();
 return {name,cpf,email,phone};
}
export function normalizeStaffCommand(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(Object.keys(input).sort())!==JSON.stringify(['commandId','contact','expectedRevision','id','reason','role','status'])||!catalogUuid(input.commandId)||!catalogUuid(input.id)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>1000000||!['ATENDENTE','ADMIN'].includes(input.role)||!['ATIVO','INATIVO'].includes(input.status))staffInvalid();
 return {commandId:input.commandId,id:input.id,expectedRevision:input.expectedRevision,role:input.role,status:input.status,contact:normalizeStaffContact(input.contact),reason:staffText(input.reason,300,true)};
}
export function staffDto(row,vault){
 if(!row||!catalogUuid(row.id)||!['ATENDENTE','ADMIN','SUPER_ADMIN'].includes(row.role)||!['ATIVO','INATIVO'].includes(row.status)||!Number.isSafeInteger(row.revision)||row.revision<0||typeof row.activated!=='boolean'||![row.createdAt,row.lastAccess].every(t=>typeof t==='string'&&(t===''||Number.isFinite(Date.parse(t)))))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
 const contact=row.contact?normalizeStaffContact(vault.open('users',row.id,row.contact)):null;
 return {id:row.id,role:row.role,status:row.status,revision:row.revision,activated:row.activated,createdAt:row.createdAt,lastAccess:row.lastAccess,
   name:contact?.name||'Conta proprietária',email:contact?.email||'',phone:contact?.phone||'',cpfMasked:contact?'***.'+contact.cpf.slice(3,6)+'.'+contact.cpf.slice(6,9)+'-**':''};
}
