import { ApiError } from './errors.mjs';
import { pack, unpack, requestMessage, verifyResponse } from './protocol.mjs';
export function createWorkspaceClient(config, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  async function invoke(action, actor, payload = {}) {
    const request = requestMessage(config, actor);
    request.action = action;
    request.payload = payload;
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
      const signed = unpack(JSON.parse(text), config.secret, 'response');
      const data = verifyResponse(signed, request);
      if (action === 'system.ping') {
        if (!data || data.ready !== true || data.environment !== config.environment || data.schemaVersion !== 1) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { ready: true, environment: data.environment, schemaVersion: data.schemaVersion };
      }
      if (action === 'identity.guard.attempt') {
        if (!data || typeof data.allowed !== 'boolean' || !Number.isSafeInteger(data.retryAfterSeconds) ||
            data.retryAfterSeconds < 0 || data.retryAfterSeconds > 3600 || (data.allowed ? data.retryAfterSeconds !== 0 : data.retryAfterSeconds < 1)) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { allowed: data.allowed, retryAfterSeconds: data.retryAfterSeconds };
      }
      if (action === 'identity.challenge.create') {
        if (!data || data.challengeId !== payload.challengeId || !Number.isSafeInteger(data.expiresAt) ||
            data.expiresAt <= signed.sentAt || data.expiresAt > signed.sentAt + 600_000) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { challengeId: data.challengeId, expiresAt: data.expiresAt };
      }
      if (action === 'identity.challenge.consume') {
        if (!data || typeof data.verified !== 'boolean') throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { verified: data.verified };
      }
      if (action === 'identity.session.read') {
        if (!data || typeof data !== 'object') throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        const { id, sessionId, role, assurance, authenticatedAt, expiresAt, authorizationVersion } = data;
        return { id, sessionId, role, assurance, authenticatedAt, expiresAt, authorizationVersion };
      }
      if (action.startsWith('identity.session.')) {
        if (data?.revoked !== true) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { revoked: true };
      }
      if (!data || !Number.isSafeInteger(data.schemaVersion) || !Array.isArray(data.tables) || data.tables.some(t => typeof t !== 'string')) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
      return { schemaVersion: data.schemaVersion, tables: data.tables };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    }
  }
  return { schema: actor => invoke('system.schema', actor), ping: () => invoke('system.ping', null),
    reserveAuthAttempt: payload => invoke('identity.guard.attempt', null, payload),
    createAuthChallenge: payload => invoke('identity.challenge.create', null, payload),
    consumeAuthChallenge: payload => invoke('identity.challenge.consume', null, payload),
    readSession: tokenHash => invoke('identity.session.read', null, { tokenHash }),
    revokeSession: tokenHash => invoke('identity.session.revoke', null, { tokenHash }),
    revokeOtherSessions: tokenHash => invoke('identity.session.revokeOthers', null, { tokenHash }),
  };
}
