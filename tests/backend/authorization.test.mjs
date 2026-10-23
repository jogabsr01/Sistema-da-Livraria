import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from '../../backend/authorization.mjs';

const now = 1_800_000_000_000;
function principal(extra = {}) {
  return { id: randomUUID(), sessionId: randomUUID(), role: 'ATENDENTE', assurance: 'pin',
    authenticatedAt: now - 1_000, expiresAt: now + 3_600_000, authorizationVersion: 1, ...extra };
}
function check(actor, operation, extra = {}) { return requirePermission(actor, operation, { now, ...extra }); }
const forbidden = { status: 403, code: 'FORBIDDEN' };
const unauthenticated = { status: 401, code: 'UNAUTHENTICATED' };
const reauthenticate = { status: 401, code: 'REAUTHENTICATION_REQUIRED' };

test('attendant capability matrix permits operations but rejects management and reports', () => {
  const actor = principal();
  for (const action of ['products.read', 'products.write', 'stock.receive', 'sales.create', 'profile.self.read',
    'schedule.self.read', 'notifications.self.read', 'sessions.self.revoke']) assert.equal(check(actor, action), actor);
  for (const action of ['products.delete', 'reports.read', 'audit.read', 'niches.write', 'schedule.write', 'stock.adjust',
    'users.attendant.manage', 'users.admin.manage', 'config.manage', 'unknown.action', '__proto__']) {
    assert.throws(() => check(actor, action), forbidden);
  }
});

test('admin management targets are checked using separate explicit role capabilities', () => {
  const actor = principal({ role: 'ADMIN', assurance: 'passkey' });
  assert.equal(check(actor, 'users.attendant.manage', { targetRole: 'ATENDENTE' }), actor);
  for (const targetRole of [undefined, 'ADMIN', 'SUPER_ADMIN', 'admin']) {
    assert.throws(() => check(actor, 'users.attendant.manage', { targetRole }), forbidden);
  }
  assert.throws(() => check(actor, 'users.admin.manage', { targetRole: 'ADMIN' }), forbidden);
  assert.throws(() => check(actor, 'config.manage'), forbidden);
  const owner = principal({ role: 'SUPER_ADMIN', assurance: 'mfa' });
  assert.equal(check(owner, 'users.admin.manage', { targetRole: 'ADMIN' }), owner);
  assert.equal(check(owner, 'users.admin.manage', { targetRole: 'SUPER_ADMIN' }), owner);
  assert.equal(check(owner, 'config.manage'), owner);
  assert.throws(() => check(owner, 'users.admin.manage', { targetRole: 'ATENDENTE' }), forbidden);
});

test('administrative access and sensitive changes require genuine strong and recent assurance', () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) {
    assert.throws(() => check(principal({ role }), 'products.read'), reauthenticate);
    assert.equal(check(principal({ role, assurance: 'mfa', authenticatedAt: now - 600_000 }), 'products.read').role, role);
    for (const action of ['reports.read', 'audit.read', 'stock.adjust', 'users.attendant.manage']) {
      assert.throws(() => check(principal({ role, assurance: 'mfa', authenticatedAt: now - 300_001 }), action, { targetRole: 'ATENDENTE' }), reauthenticate);
      assert.equal(check(principal({ role, assurance: 'passkey', authenticatedAt: now - 300_000 }), action, { targetRole: 'ATENDENTE' }).role, role);
    }
  }
  assert.throws(() => check(principal(), 'profile.self.write'), reauthenticate);
  assert.equal(check(principal({ assurance: 'mfa' }), 'profile.self.write').role, 'ATENDENTE');
  assert.equal(check(principal({ role: 'ADMIN', assurance: 'passkey', authenticatedAt: now - 600_000 }), 'sessions.self.revoke').role, 'ADMIN', 'logout does not require recent MFA');
});

test('self capabilities cannot target another user even for a super administrator', () => {
  for (const role of ['ATENDENTE', 'ADMIN', 'SUPER_ADMIN']) {
    const actor = principal({ role, assurance: 'mfa' });
    for (const action of ['profile.self.read', 'profile.self.write', 'schedule.self.read', 'notifications.self.read', 'sessions.self.revoke']) {
      assert.equal(check(actor, action, { targetUserId: actor.id }), actor);
      assert.throws(() => check(actor, action, { targetUserId: randomUUID() }), forbidden);
      assert.throws(() => check(actor, action, { targetUserId: null }), forbidden);
    }
  }
});

test('invalid or expired trusted principals fail closed before any permission is granted', () => {
  const actor = principal();
  for (const change of [{ id: '' }, { sessionId: '' }, { expiresAt: now }, { expiresAt: undefined },
    { expiresAt: now - 1 }, { authorizationVersion: 0 }, { authorizationVersion: '1' },
    { authenticatedAt: now + 30_001 }, { authenticatedAt: -1 }, { authenticatedAt: NaN }]) {
    assert.throws(() => check({ ...actor, ...change }, 'products.read'), unauthenticated);
  }
  assert.throws(() => check(null, 'products.read'), unauthenticated);
  for (const change of [{ role: 'owner' }, { role: '__proto__' }, { assurance: 'email-only' }]) {
    assert.throws(() => check({ ...actor, ...change }, 'products.read'), forbidden);
  }
});

const origin = 'https://dev.example.invalid';
function mutation({ method = 'POST', url = origin + '/api/v1/profile', headers = {} } = {}) {
  return new Request(url, { method, headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers } });
}
const csrfRejected = { status: 403, code: 'CSRF_REJECTED' };

test('same-origin JSON mutations are accepted only with exact origin and fetch metadata', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const request = mutation({ method }); assert.equal(requireSameOriginMutation(request, origin), request);
  }
  assert.doesNotThrow(() => requireSameOriginMutation(mutation({ headers: { 'content-type': 'application/json; charset=utf-8' } }), origin));
  assert.doesNotThrow(() => requireSameOriginMutation(mutation({ headers: { 'content-type': 'application/json; charset="UTF-8"' } }), origin));
  const noMetadata = mutation(); noMetadata.headers.delete('sec-fetch-site');
  assert.doesNotThrow(() => requireSameOriginMutation(noMetadata, origin));
  for (const request of [mutation({ method: 'GET' }), mutation({ url: 'https://prod.example.invalid/api' }),
    mutation({ headers: { origin: 'https://dev.example.invalid.attacker.invalid' } }), mutation({ headers: { origin: 'null' } }),
    mutation({ headers: { 'sec-fetch-site': 'same-site' } }), mutation({ headers: { 'sec-fetch-site': 'cross-site' } })]) {
    assert.throws(() => requireSameOriginMutation(request, origin), csrfRejected);
  }
  const noOrigin = mutation(); noOrigin.headers.delete('origin');
  assert.throws(() => requireSameOriginMutation(noOrigin, origin), csrfRejected);
});

test('form requests, missing media types and noncanonical configuration are rejected', () => {
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x',
    'application/json; charset=utf-16', 'application/json; charset=utf-8; other=1', 'application/json, text/plain']) {
    assert.throws(() => requireSameOriginMutation(mutation({ headers: { 'content-type': contentType } }), origin), csrfRejected);
  }
  const noType = mutation(); noType.headers.delete('content-type');
  assert.throws(() => requireSameOriginMutation(noType, origin), csrfRejected);
  for (const configured of ['http://dev.example.invalid', origin + '/', origin + '/api', origin + '?x=1',
    'https://user:password@dev.example.invalid', '', undefined]) {
    assert.throws(() => requireSameOriginMutation(mutation(), configured), { status: 503, code: 'CONFIGURATION_UNAVAILABLE' });
  }
});

test('session-bound CSRF tokens require canonical 256-bit value and constant-time equality', () => {
  const token = randomBytes(32).toString('base64url');
  const request = mutation({ headers: { 'x-csrf-token': token } });
  assert.equal(requireCsrfToken(request, token), request);
  for (const received of [undefined, '', randomBytes(32).toString('base64url'), 'A'.repeat(42) + 'B', token + '=']) {
    const wrong = mutation(); if (received !== undefined) wrong.headers.set('x-csrf-token', received);
    assert.throws(() => requireCsrfToken(wrong, token), csrfRejected);
  }
  assert.throws(() => requireCsrfToken(request, null), csrfRejected);
});
