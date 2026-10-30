import { randomUUID } from 'node:crypto';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { sessionTransportContext,validateSessionPrincipal,createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';

const ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function loadNotificationSettings(env = process.env) {
  if (env.WORKSPACE_NOTIFICATIONS_ENABLED !== 'true' || env.WORKSPACE_CATALOG_ENABLED !== 'true') throw new ApiError(503, 'NOTIFICATIONS_NOT_ACTIVATED');
  return loadSessionSettings(env);
}
export function createNotificationHandler(dependencies = {}) {
  return async request => {
    const requestId = randomUUID();
    try {
      const url = new URL(request.url), operation = url.pathname.split('/').at(-1);
      if (url.origin !== ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      if (!['bootstrap','summary', 'list', 'read', 'state', 'report'].includes(operation)) throw new ApiError(404, 'NOT_FOUND');
      const mutation = ['read', 'state', 'report'].includes(operation), method = mutation ? 'POST' : 'GET';
      if (request.method !== method) { const response = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); response.headers.set('allow', method); return response; }
      const settings = (dependencies.loadSettings || loadNotificationSettings)(), client = (dependencies.createClient || createWorkspaceClient)(settings.config);
      const sessions = createSessionService(settings, { client });
      if (mutation) requireSameOriginMutation(request, ORIGIN);
      if(operation==='bootstrap'){
        if([...url.searchParams.keys()].some(k=>!['offset','history'].includes(k)||url.searchParams.getAll(k).length!==1))throw new ApiError(400,'INVALID_NOTIFICATION');
        const offset=url.searchParams.get('offset')||'0',history=url.searchParams.get('history')||'false';if(!/^\d{1,4}$/.test(offset)||Number(offset)>5000||!['true','false'].includes(history))throw new ApiError(400,'INVALID_NOTIFICATION');
        const context=sessionTransportContext(request,settings),data=await client.notifications('bootstrap',context.actor,{offset:Number(offset),history:history==='true'}),principal=validateSessionPrincipal(data.principal,Date.now(),settings.config.adminPinLogin===true);requirePermission(principal,'notifications.self.read');
        const items=data.items.map(item=>{if(item.type==='MAINTENANCE_COMPLETED'&&!['ADMIN','SUPER_ADMIN'].includes(principal.role))throw new ApiError(502,'UPSTREAM_UNTRUSTED');if(item.type.startsWith('SCHEDULE_')){if(item.recipientId!==principal.id)throw new ApiError(502,'UPSTREAM_UNTRUSTED');const{recipientId,...safe}=item;return safe;}return item;});
        return json({data:{items,total:data.total,nextOffset:data.nextOffset,summary:data.summary,user:{id:principal.id,role:principal.role,assurance:principal.assurance,expiresAt:principal.expiresAt},csrfToken:context.csrfToken},requestId});
      }
      const principal = await sessions.authenticate(request);
      requirePermission(principal, operation === 'report' ? 'reports.read' : operation === 'state' ? 'notifications.manage' : 'notifications.self.read');
      if (mutation) requireCsrfToken(request, sessions.csrfFor(request,principal));
      let payload = {};
      if (operation === 'list') {
        if ([...url.searchParams.keys()].some(k => !['offset', 'history'].includes(k) || url.searchParams.getAll(k).length !== 1)) throw new ApiError(400, 'INVALID_NOTIFICATION');
        const offset = url.searchParams.get('offset') || '0', history = url.searchParams.get('history') || 'false';
        if (!/^\d{1,4}$/.test(offset) || Number(offset) > 5000 || !['true', 'false'].includes(history)) throw new ApiError(400, 'INVALID_NOTIFICATION');
        payload = { offset: Number(offset), history: history === 'true' };
      } else if (url.search) throw new ApiError(400, 'INVALID_NOTIFICATION');
      if (mutation) {
        let content = '', size = 0; const reader = request.body?.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        try {
          if (reader) { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
            if (size > 2000) { await reader.cancel(); throw new ApiError(413, 'INVALID_NOTIFICATION'); } content += decoder.decode(value, { stream: true }); } }
          content += decoder.decode(); payload = JSON.parse(content);
        } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_NOTIFICATION'); }
        const exact = keys => payload && typeof payload === 'object' && !Array.isArray(payload) && JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(keys.sort());
        if (operation === 'read' && (!exact(['id']) || !catalogUuid(payload.id)) ||
            operation === 'state' && (!exact(['commandId','id','state']) || !catalogUuid(payload.commandId) || !catalogUuid(payload.id) || !['ABERTA','EM_ATENDIMENTO'].includes(payload.state)) ||
            operation === 'report' && (!exact(['scope','supplier','format']) || !['zero','low'].includes(payload.scope) || payload.supplier !== null && (typeof payload.supplier !== 'string' || payload.supplier.length > 160) || !['view','csv','print','copy'].includes(payload.format))) throw new ApiError(400, 'INVALID_NOTIFICATION');
      }
      const data=await client.notifications(operation,{sessionTokenHash:principal.sessionTokenHash},payload);if(operation==='list')data.items=data.items.map(item=>{if(item.type==='MAINTENANCE_COMPLETED'&&!['ADMIN','SUPER_ADMIN'].includes(principal.role))throw new ApiError(502,'UPSTREAM_UNTRUSTED');if(item.type.startsWith('SCHEDULE_')){if(item.recipientId!==principal.id)throw new ApiError(502,'UPSTREAM_UNTRUSTED');const {recipientId,...safe}=item;return safe;}return item;});return json({data,requestId});
    } catch (error) { return safeFailure(error, requestId); }
  };
}
