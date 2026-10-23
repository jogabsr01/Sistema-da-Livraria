import { ApiError } from './errors.mjs';
const unavailable=()=>{throw new ApiError(502,'POSTAL_CODE_UNAVAILABLE');};
export function normalizePostalCode(value){if(typeof value!=='string'||!/^\d{5}-?\d{3}$/.test(value))throw new ApiError(400,'INVALID_CUSTOMER');return value.replace('-','');}
export function createPostalCodeLookup({fetchImpl=fetch}={}){return async value=>{
 const postalCode=normalizePostalCode(value);let response;
 try{response=await fetchImpl('https://brasilapi.com.br/api/cep/v2/'+postalCode,{redirect:'manual',signal:AbortSignal.timeout(4500),headers:{accept:'application/json'}});}catch{unavailable();}
 if(response.status===404)throw new ApiError(404,'POSTAL_CODE_NOT_FOUND');if(!response.ok)unavailable();
 const reader=response.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
 try{if(reader){while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000){await reader.cancel();unavailable();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
 const p=JSON.parse(text),clean=(s,max)=>{if(s===null||s===undefined)return '';if(typeof s!=='string'||s.length>max||/[\x00-\x1f\x7f]/.test(s)||/^[=+@-]/.test(s.trim()))unavailable();return s.normalize('NFC').trim();};
 if(p.cep!==postalCode||typeof p.state!=='string'||!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(p.state))unavailable();
 const city=clean(p.city,100);if(!city)unavailable();return {postalCode,state:p.state,city,street:clean(p.street,200),district:clean(p.neighborhood,100)};
 }catch(e){if(e instanceof ApiError)throw e;unavailable();}
};}
