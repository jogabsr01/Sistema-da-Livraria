// Disposable identities only; no real CPF, email, Google service or credentials.
import { randomUUID, randomBytes } from 'node:crypto';
import { ownerFixture } from './owner-access-fixture.mjs';
import { createStaffHandler, loadStaffSettings, STAFF_ORIGIN } from '../../backend/staff-handler.mjs';
import { createSessionTokens } from '../../backend/credential-core.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
import { createPersonalDataVault } from '../../backend/personal-data.mjs';
import { loadOwnerAccessSettings, createOwnerAccessService } from '../../backend/owner-access.mjs';
export function staffFixture(){
 const s=ownerFixture();s.env.WORKSPACE_STAFF_ENABLED='true';s.gas.props.STAFF_ENABLED='true';s.env.WORKSPACE_PERSONAL_DATA_KEY=randomBytes(32).toString('hex');s.env.WORKSPACE_PERSONAL_INDEX_KEY=randomBytes(32).toString('hex');
 const settings=loadStaffSettings(s.env),vault=createPersonalDataVault(settings),tokens=createSessionTokens({...settings.config,tokenKey:settings.tokenKey});
 const handler=createStaffHandler({loadSettings:()=>loadStaffSettings(s.env),createClient:()=>s.client}),sessions=createSessionService(settings,{client:s.client});
 const add=(table,value)=>table.appendRow(table.rows[0].map(k=>value[k]??''));
 function session(id=s.gas.props.IDENTITY_OWNER_USER_ID){
  const users=s.main.getSheetByName('Usuarios'),row=users.rows.find(r=>r[0]===id);row[users.rows[0].indexOf('Primeiro_Acesso_Concluido')]=true;
  const configs=s.main.getSheetByName('Configuracoes'),epoch=configs.rows.find(r=>r[0]==='identity.version.'+id)[1];
  const issued=tokens.issue(),at=Date.now()-1000;
  add(s.main.getSheetByName('Sessoes'),{ID_Sessao:randomUUID(),ID_Usuario:id,Criado_Em:new Date(at).toISOString(),Expira_Em:new Date(at+3600000).toISOString(),Ultima_Atividade:new Date(at).toISOString(),Token_Hash:issued.tokenHash,Nivel_Autenticacao:'passkey',Versao_Autorizacao:epoch});
  return {...issued,id,cookie:'__Host-livraria_session='+issued.rawToken,actor:{sessionTokenHash:issued.tokenHash}};
 }
 const master=session();
 function command(extra={}){return {commandId:randomUUID(),id:randomUUID(),expectedRevision:0,role:'ATENDENTE',status:'ATIVO',contact:{name:'Pessoa de teste',cpf:'52998224725',email:'pessoa@example.invalid',phone:'11999999999'},reason:'Cadastro fictício de teste',...extra};}
 async function http(op,input,who=master,headers={}){const data=await sessions.current(new Request(STAFF_ORIGIN+'/api/v1/session',{headers:{cookie:who.cookie}}));return handler(new Request(STAFF_ORIGIN+'/api/v1/staff/'+op,{method:input?'POST':'GET',headers:{cookie:who.cookie,...(input?{origin:STAFF_ORIGIN,'content-type':'application/json','x-csrf-token':data.csrfToken}:{}),...headers},...(input?{body:JSON.stringify(input)}:{})}));}
 return {...s,settings,vault,master,handler,session,command,http,accessService:()=>createOwnerAccessService(loadOwnerAccessSettings(s.env),{client:s.client})};
}
