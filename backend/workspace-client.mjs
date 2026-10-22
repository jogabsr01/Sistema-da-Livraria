import { ApiError } from './errors.mjs';
import { pack, unpack, requestMessage, verifyResponse } from './protocol.mjs';
export function createWorkspaceClient(config, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  return { async schema(actor) {
    const request = requestMessage(config, actor);
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(config.scriptUrl, { method: 'POST', redirect: 'manual', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(pack(request, config.secret, 'request')) });
      // Apps Script ContentService uses a one-time HTTPS redirect. Never forward the
      // signed POST or any credential to a redirected destination.
      if ([302, 303].includes(response.status)) {
        const url = new URL(response.headers.get('location'));
        if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal });
      }
      if (!response.ok) throw new ApiError(502, 'UPSTREAM_UNAVAILABLE');
      const text = await response.text();
      if (text.length > 180_000) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
      const data = verifyResponse(unpack(JSON.parse(text), config.secret, 'response'), request);
      if (!data || !Number.isSafeInteger(data.schemaVersion) || !Array.isArray(data.tables) || data.tables.some(t => typeof t !== 'string')) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
      return { schemaVersion: data.schemaVersion, tables: data.tables };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    }
  } };
}
