import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { logFirestoreError } from './firestore-error-log.mjs';
import { parseServiceAccountJson } from './firestore-config.mjs';
import { FIRESTORE_COLLECTIONS, FIRESTORE_SCHEMA_VERSION } from './firestore-schema.mjs';
import { createFirestoreIdentityService } from './firestore-identity.mjs';
import { createFirestoreCatalogService } from './firestore-catalog.mjs';
import { createFirestoreSalesService } from './firestore-sales.mjs';
import { createFirestoreOperationsService } from './firestore-operations.mjs';
import { createFirestoreNotificationService } from './firestore-notifications.mjs';
import { createFirestoreScheduleService } from './firestore-schedules.mjs';
import { createFirestoreAuditService } from './firestore-audit.mjs';
import { createFirestoreCustomerService } from './firestore-customers.mjs';
import { createFirestoreStaffService } from './firestore-staff.mjs';
import { createFirestoreProfileService } from './firestore-profile.mjs';
import { createFirestorePasskeyService } from './firestore-passkeys.mjs';
import { createFirestoreReportService } from './firestore-reports.mjs';
import { createFirestoreInsightsService } from './firestore-insights.mjs';
import { createFirestoreAccessService } from './firestore-access.mjs';
import { createFirestoreCredentialStore } from './firestore-credential-store.mjs';
import { createFirestoreNicheService } from './firestore-niches.mjs';
import { createFirestoreKeyManagementService } from './firestore-key-management.mjs';
import { createFirestoreRateLimitService } from './firestore-rate-limits.mjs';
import { processPendingFirestoreOutbox } from './firestore-outbox.mjs';

export { FIRESTORE_COLLECTIONS, FIRESTORE_SCHEMA_VERSION } from './firestore-schema.mjs';

function unavailable() {
  throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
}

function firestoreUnavailable() {
  throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
}

function operationNotReady() {
  throw new ApiError(503, 'FIRESTORE_OPERATION_NOT_READY');
}

const firestoreCacheKey = Symbol.for('livraria.firestore.client.v1');

function createDefaultFirestore(settings) {
  if (!settings || !settings.projectId) {
    console.error(JSON.stringify({ event: 'firestore_client_configuration_unavailable',
      projectIdPresent: !!settings?.projectId, databaseIdPresent: !!settings?.databaseId,
      credentialsPresent: !!settings?.credentials, applicationCredentialsPresent: !!settings?.applicationCredentials,
      emulatorHostPresent: !!settings?.emulatorHost }));
    unavailable();
  }
  const options = { projectId: settings.projectId, databaseId: settings.databaseId || '(default)' };
  if (settings.emulatorHost) {
    const separator = settings.emulatorHost.lastIndexOf(':');
    options.host = settings.emulatorHost.slice(0, separator);
    options.port = Number(settings.emulatorHost.slice(separator + 1));
    options.ssl = false;
  }
  // Credential files can change without their paths changing. Do not cache
  // those clients (or emulator clients) across independent operations.
  const construct = () => {
    try {
      const credentials = settings.credentials || (settings.applicationCredentials ? parseServiceAccountJson(readFileSync(settings.applicationCredentials, 'utf8')) : null);
      if (credentials) {
        const authClient = new JWT({ email: credentials.client_email, key: credentials.private_key });
        options.auth = new GoogleAuth({ authClient, projectId: settings.projectId });
      }
      return new Firestore(options);
    }
    catch (error) { logFirestoreError('CONSTRUCTOR', error); throw error; }
  };
  if (!settings.credentials || settings.emulatorHost) return construct();
  const key = createHash('sha256').update(JSON.stringify([options.projectId, options.databaseId,
    settings.credentials.project_id, settings.credentials.client_email, settings.credentials.private_key])).digest('hex');
  const cached = globalThis[firestoreCacheKey];
  if (cached?.key === key) return cached.client;
  const client = construct();
  const terminate = client.terminate.bind(client);
  client.terminate = (...args) => {
    if (globalThis[firestoreCacheKey]?.client === client) delete globalThis[firestoreCacheKey];
    return terminate(...args);
  };
  globalThis[firestoreCacheKey] = { key, client };
  return client;
}

export function createFirestoreDb(config) {
  return createDefaultFirestore(config?.firestore ?? config);
}

export function createFirestoreWorkspaceClient(config, {
  firestoreClient = null,
  firestoreFactory = createDefaultFirestore,
  now = () => performance.now(),
} = {}) {
  const settings = config?.firestore;
  if (!config || !['firestore', 'shadow'].includes(config.storageMode) || !settings ||
      settings.mode !== config.storageMode) unavailable();

  let db = firestoreClient;
  let calls = 0;
  let durationMs = 0;

  async function measured(operation) {
    calls++;
    const started = now();
    try { return await operation(); }
    finally { durationMs += Math.max(0, now() - started); }
  }

  function getDb() {
    if (!db) db = firestoreFactory(settings);
    if (!db || typeof db.listCollections !== 'function') unavailable();
    return db;
  }

  async function ping() {
    try {
      await measured(async () => {
        const collections = await getDb().listCollections();
        if (!Array.isArray(collections)) firestoreUnavailable();
      });
      return { ready: true, environment: config.environment, schemaVersion: FIRESTORE_SCHEMA_VERSION };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logFirestoreError('PING', error);
      firestoreUnavailable();
    }
  }

  async function schema() {
    return measured(async () => ({
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      tables: [...FIRESTORE_COLLECTIONS],
    }));
  }

  let identity;
  function getIdentity() {
    if (!identity) identity = createFirestoreIdentityService({ db: getDb(), now: () => Date.now() });
    return identity;
  }

  let catalog;
  function getCatalog() {
    if (!catalog) catalog = createFirestoreCatalogService({ db: getDb(), identityService: getIdentity(), config });
    return catalog;
  }

  let sales;
  function getSales() {
    if (!sales) sales = createFirestoreSalesService({ db: getDb(), identityService: getIdentity(), config });
    return sales;
  }

  let operations;
  function getOperations() {
    if (!operations) operations = createFirestoreOperationsService({ db: getDb(), identityService: getIdentity(), config });
    return operations;
  }

  let notifications;
  function getNotifications() {
    if (!notifications) notifications = createFirestoreNotificationService({ db: getDb(), identityService: getIdentity(), config });
    return notifications;
  }

  let schedules;
  function getSchedules() {
    if (!schedules) schedules = createFirestoreScheduleService({ db: getDb(), identityService: getIdentity(), config });
    return schedules;
  }

  let audit;
  function getAudit() {
    if (!audit) audit = createFirestoreAuditService({ db: getDb(), identityService: getIdentity(), config });
    return audit;
  }

  let customers;
  function getCustomers() {
    if (!customers) customers = createFirestoreCustomerService({ db: getDb(), identityService: getIdentity(), config });
    return customers;
  }

  let staff;
  function getStaff() {
    if (!staff) staff = createFirestoreStaffService({ db: getDb(), identityService: getIdentity(), config });
    return staff;
  }

  let profile;
  function getProfile() {
    if (!profile) profile = createFirestoreProfileService({ db: getDb(), identityService: getIdentity(), config });
    return profile;
  }

  let passkeys;
  function getPasskeys() {
    if (!passkeys) passkeys = createFirestorePasskeyService({ db: getDb() });
    return passkeys;
  }

  let reports;
  function getReports() {
    if (!reports) reports = createFirestoreReportService({ db: getDb(), identityService: getIdentity(), config });
    return reports;
  }

  let insights;
  function getInsights() {
    if (!insights) insights = createFirestoreInsightsService({ db: getDb(), identityService: getIdentity(), config });
    return insights;
  }

  let credentials;
  function getCredentials() {
    if (!credentials) credentials = createFirestoreCredentialStore({ db: getDb(), config });
    return credentials;
  }

  let keyManagement;
  function getKeyManagement() {
    if (!keyManagement) keyManagement = createFirestoreKeyManagementService({ db: getDb(), identityService: getIdentity(), config, now: () => Date.now() });
    return keyManagement;
  }

  let access;
  function getAccess() {
    if (!access) access = createFirestoreAccessService({ db: getDb(), config });
    return access;
  }

  let niches;
  function getNiches() {
    if (!niches) niches = createFirestoreNicheService({ db: getDb(), identityService: getIdentity(), config });
    return niches;
  }

  let rateLimits;
  function getRateLimits() {
    if (!rateLimits) rateLimits = createFirestoreRateLimitService({ db: getDb(), now: () => Date.now() });
    return rateLimits;
  }

  const notReady = () => operationNotReady();
  async function startAndDeliver(start, payload) {
    const result = await start(payload);
    if (config.environment !== 'prod' || process.env.VERCEL !== '1' || result?.outcome !== 'SENT') return result;
    try {
      const delivery = await processPendingFirestoreOutbox({ db:getDb(), config, emailId:`email:auth:${payload.tokenHash}` });
      console.info(JSON.stringify({event:'access_email_delivery',outcome:delivery.emailSent?'PROVIDER_ACCEPTED':delivery.uncertain?'UNCERTAIN':'NOT_ACCEPTED'}));
      if (!delivery.emailSent) return {...result,outcome:'DELIVERY_UNAVAILABLE'};
    } catch (error) {
      console.error(JSON.stringify({event:'access_email_delivery',outcome:'ERROR',code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)?error.code:'OUTBOX_ERROR'}));
      return {...result,outcome:'DELIVERY_UNAVAILABLE'};
    }
    return result;
  }
  return {
    keys: (operation, actor, payload) => getKeyManagement().execute(operation, actor, payload),
    insights: (operation, actor, payload) => getInsights().execute(operation, actor, payload),
    reports: (operation, actor, payload) => getReports().execute(operation, actor, payload),
    audit: (operation, actor, payload) => getAudit().execute(operation, actor, payload),
    schedules: (operation, actor, payload) => getSchedules().execute(operation, actor, payload),
    niches: (operation, actor, payload) => getNiches().execute(operation, actor, payload),
    schema,
    ping,
    profile: (operation, actor, payload) => getProfile().execute(operation, actor, payload),
    operations: (operation, actor, payload) => getOperations().execute(operation, actor, payload),
    customers: (operation, actor, payload) => getCustomers().execute(operation, actor, payload),
    staff: (operation, actor, payload) => getStaff().execute(operation, actor, payload),
    staffAccess: (operation, payload) => operation === 'lookup' ? getCredentials().lookup({ ...payload, staffLookup: true }).then(account => ({ account })) : operation === 'start' ? startAndDeliver(getAccess().staffStart,payload) : operation === 'recover' ? startAndDeliver(getAccess().staffRecover,payload) : notReady(),
    notifications: async (operation, actor, payload) => {
      const result=await getNotifications().execute(operation, actor, payload);
      if (!['summary','list','bootstrap'].includes(operation)) return result;
      let changed=false;
      try {
        for(let i=0;i<20;i++){const item=await processPendingFirestoreOutbox({db:getDb(),config,stockOnly:true});if(!item.processed)break;changed=true;}
      } catch(error) { logFirestoreError('STOCK_ALERT_PROJECTION',error); }
      return changed ? getNotifications().execute(operation, actor, payload) : result;
    },
    checkoutReceipt: (actor, payload) => getSales().receipt(actor, payload),
    checkout: async (actor, payload) => {
      const receipt=await getSales().checkout(actor,payload);
      try { for(let i=0;i<100;i++){const item=await processPendingFirestoreOutbox({db:getDb(),config,stockOnly:true});if(!item.processed)break;} }
      catch(error) { logFirestoreError('STOCK_ALERT_PROJECTION',error); }
      return receipt;
    },
    catalog: (operation, actor, payload) => getCatalog().execute(operation, actor, payload),
    access: (operation, payload) => {
      if (operation === 'ownerLookup') return getCredentials().ownerLookup(payload);
      const service = getAccess();
      if (operation === 'start') return startAndDeliver(service.start,payload);
      if (operation === 'recover') return startAndDeliver(service.recover,payload);
      if (operation === 'login') return service.login(payload);
      if (operation === 'passwordLogin') return service.passwordLogin(payload);
      if (operation === 'read') return service.read(payload);
      if (operation === 'email') return service.email(payload);
      if (operation === 'password') return service.password(payload);
      if (operation === 'rescue') return service.rescue(payload);
      if (operation === 'rescueBegin') return service.rescueBegin(payload);
      if (operation === 'rescueKey') return service.rescueKey(payload);
      if (operation === 'saveProof') return service.saveProof(payload);
      if (operation === 'commit') return service.commit(payload);
      return notReady();
    },
    listPasskeys: payload => getPasskeys().listPasskeys(payload),
    beginPasskey: payload => getPasskeys().beginPasskey(payload),
    takePasskey: payload => getPasskeys().takePasskey(payload),
    registerPasskey: payload => getPasskeys().registerPasskey(payload),
    advancePasskeyCounter: payload => getPasskeys().advanceCounter(payload),
    recordSecurityEvent: async () => ({ recorded: true }),
    startOwnerAccess: payload => startAndDeliver(getAccess().start,payload),
    timings: () => Object.freeze({ calls, durationMs: Math.round(durationMs) }),
    verifyAccessEmail: payload => getAccess().email(payload),
    readAccessForPassword: payload => getAccess().read(payload),
    readAccessForPin: payload => getAccess().read(payload),
    lookupAccessLogin: payload => getCredentials().loginLookup(payload),
    prepareBiometricOptions: payload => getAccess().prepareBiometricOptions(payload),
    prepareAccessOptions: payload => getAccess().prepareOptions(payload),
    prepareDeviceAccess: payload => getAccess().prepareDeviceAccess(payload),
    prepareAccessCompletion: payload => getAccess().prepareCompletion(payload),
    reserveAuthAttempt: payload => getRateLimits().reserve(payload),
    createAuthChallenge: notReady,
    consumeAuthChallenge: notReady,
    readSession: tokenHash => getIdentity().readSession(tokenHash),
    revokeSession: tokenHash => getIdentity().revokeSession(tokenHash),
    revokeOtherSessions: tokenHash => getIdentity().revokeOtherSessions(tokenHash),
  };
}
