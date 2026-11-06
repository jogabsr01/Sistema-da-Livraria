// Disposable Google contract and authoritative session rows; no real identities.
import { randomUUID } from 'node:crypto';
import { ownerFixture } from './owner-access-fixture.mjs';
import { createSessionTokens } from '../../backend/credential-core.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
import { createCatalogHandler } from '../../backend/catalog-handler.mjs';
import { normalizeProduct } from '../../backend/catalog-model.mjs';
export const CATALOG_ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function catalogFixture() {
  const s = ownerFixture(); s.env.WORKSPACE_CATALOG_ENABLED = 'true'; s.gas.props.CATALOG_ENABLED = 'true'; s.gas.call('provisionDevelopmentCatalog');
  const journal = s.gas.sheets.get(s.gas.props.CATALOG_JOURNAL_ID).getSheetByName('_Product_Commands');
  const tokens = createSessionTokens({ ...s.settings.config, tokenKey:s.settings.tokenKey });
  function session(role = 'ATENDENTE', userId = randomUUID()) {
    const users = s.main.getSheetByName('Usuarios'), fields = { ID_Usuario:userId, Perfil:role, Status:'ATIVO', Primeiro_Acesso_Concluido:true };
    users.appendRow(users.rows[0].map(key => fields[key] ?? ''));
    const configs = s.main.getSheetByName('Configuracoes'); configs.appendRow(configs.rows[0].map(key => ({ Chave:'identity.version.' + userId, Valor:1 }[key] ?? '')));
    const issued = tokens.issue(), table = s.main.getSheetByName('Sessoes'), timestamp = Date.now() - 1000;
    const value = { ID_Sessao:randomUUID(),ID_Usuario:userId,Criado_Em:new Date(timestamp).toISOString(),Expira_Em:new Date(timestamp+3600000).toISOString(),Ultima_Atividade:new Date(timestamp).toISOString(),Token_Hash:issued.tokenHash,Nivel_Autenticacao:role === 'ATENDENTE' ? 'pin':'passkey',Versao_Autorizacao:1 };
    table.appendRow(table.rows[0].map(key => value[key] ?? '')); return { ...issued,userId,cookie:'__Host-livraria_session=' + issued.rawToken,actor:{sessionTokenHash:issued.tokenHash} };
  }
  const handler = createCatalogHandler({ loadSettings:() => { if (s.env.WORKSPACE_CATALOG_ENABLED !== 'true') throw Error('test config only'); return s.settings; }, createClient:() => s.client });
  const service = createSessionService(s.settings,{client:s.client});
  return { ...s,journal,session,handler,sessionService:service,
    command(extra = {}) {
      const id = extra.id || randomUUID();
      return { commandId:randomUUID(), id, expectedVersion:0, record:normalizeProduct({ isbn:'9788543303932',title:'Livro cristão — teste descartável',author:'Autor de teste',publisher:'Editora de teste',priceCents:3290,minimumStock:2,
        nicheIds:[s.main.getSheetByName('Nichos').rows[1][0]],active:true,...extra.record },id), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'record')) };
    },
    async http(session,operation,body,extraHeaders={}) {
      const data = await service.current(new Request(CATALOG_ORIGIN + '/api/v1/session',{headers:{cookie:session.cookie}}));
      return handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/'+operation,{method:body?'POST':'GET',headers:{cookie:session.cookie,...(body ? {origin:CATALOG_ORIGIN,'content-type':'application/json','x-csrf-token':data.csrfToken}:{}),...extraHeaders},...(body?{body:JSON.stringify(body)}:{})}));
    },
  };
}
export function injectCatalogFault(s,stage,after=false) {
  const original = s.gas.context.accessSaveMain_; let once = true;
  s.gas.context.accessSaveMain_ = (table,row) => {
    const target = table.sheet.name === '_Product_Commands' ? row.State === 'PENDING' ? 'intent':'marker' : { Produtos:'product',Produto_Nichos:'link',Logs_Auditoria:'audit' }[table.sheet.name];
    if (!once || target !== stage) return original(table,row); once = false;
    if (after) original(table,row); throw Error('INJECTED_CATALOG_FAILURE');
  };
}
