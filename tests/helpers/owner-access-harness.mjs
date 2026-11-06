// LOCAL TEST ONLY: fake owner, fake MailApp/Sheets. Never packaged as a function.
import { createServer } from 'node:http';
import { ownerFixture, injectAccessFault } from './owner-access-fixture.mjs';
import { ApiError } from '../../backend/errors.mjs';
import { ACCESS_ORIGIN } from '../../backend/owner-access.mjs';
const fixture = ownerFixture();
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 25000) throw Error('TEST_BODY_LIMIT'); }
    if (req.url === '/test/code') { res.end(JSON.stringify({ code: fixture.gas.outbox.at(-1)?.body.match(/\n([A-Za-z0-9_-]{7}|[A-Za-z0-9_-]{43})\n/)[1] })); return; }
    if (req.url === '/test/fault') { const input = JSON.parse(body); injectAccessFault(fixture, input.stage, input.after); res.end('{}'); return; }
    if (req.url === '/test/start-timeout') {
      const input=JSON.parse(body),original=fixture.client.startOwnerAccess;
      fixture.client.startOwnerAccess=async p=>{fixture.client.startOwnerAccess=original;if(input.after)await original(p);throw new ApiError(502,'UPSTREAM_TIMEOUT');};
      res.end('{}');return;
    }
    if (req.url === '/test/disable') { fixture.env.WORKSPACE_IDENTITY_ACCESS_ENABLED = 'false'; res.end('{}'); return; }
    if (req.url === '/test/state') {
      const sessions = fixture.main.getSheetByName('Sessoes'), columns = sessions.rows[0];
      res.end(JSON.stringify({ sessions: sessions.getLastRow() - 1, activeSessions: sessions.rows.slice(1).filter(row => row[columns.indexOf('Revogado_Em')] === '').length,
        pins: fixture.priv.getSheetByName('_Pin_Verifiers').getLastRow() - 1, passkeys: fixture.priv.getSheetByName('_Passkeys').getLastRow() - 1,
        outbox: fixture.gas.outbox.length, flowStates: fixture.priv.getSheetByName('_Identity_Flows').rows.slice(1).map(row => row[4]) })); return;
    }
    const request = new Request(ACCESS_ORIGIN + req.url, { method: req.method, headers: req.headers,
      ...(req.method === 'GET' ? {} : { body }) });
    const response = req.url === '/api/v1/session' ? await fixture.sessions.current(request) : req.url === '/api/v1/session/logout' ? await fixture.sessions.logout(request) : await fixture.handler(request, { ip: '192.0.2.40' });
    const headers = Object.fromEntries(response.headers); delete headers['set-cookie'];
    res.end(JSON.stringify({ status: response.status, headers, cookies: response.headers.getSetCookie(), body: await response.text() }));
  } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'TEST_HARNESS_FAILURE' })); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
