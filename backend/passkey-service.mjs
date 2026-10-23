import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { ApiError } from './errors.mjs';
import { loadConfig } from './config.mjs';
const ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
const RP_ID = 'dev--merry-chimera-49a1f3.netlify.app';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const rejected = () => { throw new ApiError(401, 'PASSKEY_REJECTED'); };
export function loadPasskeySettings(env = process.env) {
  if (env.WORKSPACE_IDENTITY_PASSKEYS_ENABLED !== 'true') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const config = loadConfig(env);
  if (config.environment !== 'dev') throw new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
  return { config };
}
function subject(value) {
  if (!value || typeof value.subjectId !== 'string' || !UUID.test(value.subjectId) ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) rejected();
  return { subjectId: value.subjectId, authorizationVersion: value.authorizationVersion };
}
function responseSize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) rejected();
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 16384) rejected();
    const encoded = value.response?.clientDataJSON;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded) || Buffer.from(encoded, 'base64url').toString('base64url') !== encoded) rejected();
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (data.crossOrigin !== undefined && data.crossOrigin !== false || data.topOrigin !== undefined) rejected();
  } catch { rejected(); }
}
// No public route. Future enrollment must verify email/current identity BEFORE
// permitting registration; login must verify PIN + durable rate limits first.
export function createPasskeyService(settings, { client }) {
  if (settings?.config?.environment !== 'dev') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  return {
    async registrationOptions(input) {
      const user = subject(input), { credentials } = await client.listPasskeys(user);
      const options = await generateRegistrationOptions({ rpName: 'Livraria IPB — DEV', rpID: RP_ID,
        userID: new TextEncoder().encode(user.subjectId), userName: user.subjectId, userDisplayName: 'Funcionário',
        attestationType: 'none', supportedAlgorithmIDs: [-7], timeout: 120000,
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: credentials });
      const ceremonyId = randomUUID();
      await client.beginPasskey({ ...user, ceremonyId, purpose: 'REGISTER', challenge: options.challenge });
      return { ceremonyId, options };
    },
    async verifyRegistration(input, response) {
      const user = subject(input); if (typeof input.ceremonyId !== 'string' || !UUID.test(input.ceremonyId)) rejected(); responseSize(response);
      const ceremony = await client.takePasskey({ ...user, ceremonyId: input.ceremonyId, credentialId: '' });
      if (ceremony.purpose !== 'REGISTER') rejected();
      let result;
      try { result = await verifyRegistrationResponse({ response, expectedChallenge: ceremony.challenge, expectedOrigin: ORIGIN,
        expectedRPID: RP_ID, requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: [-7] }); } catch { rejected(); }
      if (!result.verified || !result.registrationInfo.userVerified) rejected();
      const { credential } = result.registrationInfo;
      await client.registerPasskey({ ...user, ceremonyId: input.ceremonyId, credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports || [] });
      return { registered: true };
    },
    async authenticationOptions(input) {
      const user = subject(input), { credentials } = await client.listPasskeys(user);
      if (!credentials.length) rejected(); // never fall back to a browser-chosen discoverable credential
      const options = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: credentials, userVerification: 'required', timeout: 120000 });
      const ceremonyId = randomUUID();
      await client.beginPasskey({ ...user, ceremonyId, purpose: 'AUTHENTICATE', challenge: options.challenge });
      return { ceremonyId, options };
    },
    async verifyAuthentication(input, response) {
      const user = subject(input); if (typeof input.ceremonyId !== 'string' || !UUID.test(input.ceremonyId)) rejected(); responseSize(response);
      const handle = response.response?.userHandle;
      if (handle !== null && handle !== undefined && (typeof handle !== 'string' || handle !== Buffer.from(user.subjectId, 'utf8').toString('base64url'))) rejected();
      const ceremony = await client.takePasskey({ ...user, ceremonyId: input.ceremonyId, credentialId: response.id });
      if (ceremony.purpose !== 'AUTHENTICATE' || !ceremony.credential) rejected();
      const stored = ceremony.credential;
      let result;
      try { result = await verifyAuthenticationResponse({ response, expectedChallenge: ceremony.challenge, expectedOrigin: ORIGIN,
        expectedRPID: RP_ID, requireUserVerification: true, credential: { id: stored.id, publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
          counter: stored.counter, transports: stored.transports } }); } catch { rejected(); }
      if (!result.verified || !result.authenticationInfo.userVerified) rejected();
      await client.advancePasskeyCounter({ ...user, ceremonyId: input.ceremonyId, credentialId: stored.id,
        expectedCounter: stored.counter, newCounter: result.authenticationInfo.newCounter });
      // Internal result only, never a cookie/user role or independently valid login.
      return { verified: true, assurance: 'passkey' };
    },
  };
}
