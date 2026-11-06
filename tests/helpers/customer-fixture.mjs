import { randomUUID } from 'node:crypto';
import { staffFixture } from './staff-fixture.mjs';
import { createCustomerHandler,loadCustomerSettings } from '../../backend/customer-handler.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
import { createCheckoutHandler,loadCheckoutSettings } from '../../backend/checkout-handler.mjs';
import { normalizeProduct } from '../../backend/catalog-model.mjs';
export const CUSTOMER_ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function customerFixture(){
 const s=staffFixture();s.env.WORKSPACE_CUSTOMERS_ENABLED='true';s.gas.props.CUSTOMERS_ENABLED='true';
 s.env.WORKSPACE_CATALOG_ENABLED='true';s.gas.props.CATALOG_ENABLED='true';s.gas.call('provisionDevelopmentCatalog');s.env.WORKSPACE_CHECKOUT_ENABLED='true';s.gas.props.CHECKOUT_ENABLED='true';
 const sessions=createSessionService(s.settings,{client:s.client}),handler=createCustomerHandler({loadSettings:()=>loadCustomerSettings(s.env),createClient:()=>s.client,postalLookup:async postalCode=>({postalCode,street:'Rua fictícia',district:'Bairro fictício',city:'Cidade fictícia',state:'SP'})}),checkout=createCheckoutHandler({loadSettings:()=>loadCheckoutSettings(s.env),createClient:()=>s.client});
 function command(extra={}){return {commandId:randomUUID(),id:randomUUID(),expectedRevision:0,record:{name:'Cliente fictício',cpf:'52998224725',email:'cliente@example.invalid',phone:'11999999999',postalCode:'',street:'',number:'',complement:'',district:'',city:'',state:'',contactPreference:'NONE',marketingConsent:false,...extra.record},...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='record'))};}
 async function call(path,body,who=s.master,headers={}){const session=await sessions.current(new Request(CUSTOMER_ORIGIN+'/api/v1/session',{headers:{cookie:who.cookie}}));const req=new Request(CUSTOMER_ORIGIN+path,{method:'POST',headers:{cookie:who.cookie,origin:CUSTOMER_ORIGIN,'content-type':'application/json','x-csrf-token':session.csrfToken,...headers},body:JSON.stringify(body)});return path==='/api/v1/checkout'?checkout(req):handler(req);}
 async function product(stock=2){const id=randomUUID(),record=normalizeProduct({title:'Livro fictício',priceCents:3290,nicheIds:[s.main.getSheetByName('Nichos').rows[1][0]],active:true},id);await s.client.catalog('save',s.master.actor,{commandId:randomUUID(),id,expectedVersion:0,record});if(stock)await s.client.catalog('receive',s.master.actor,{commandId:randomUUID(),id,expectedVersion:1,quantity:stock,reason:'Unidades de teste'});return id;}
 return {...s,customerHandler:handler,command,customerHttp:(op,p,who,headers)=>call('/api/v1/customers/'+op,p,who,headers),saleHttp:(p,who)=>call('/api/v1/checkout',p,who),product};
}
