import { Firestore } from '@google-cloud/firestore';
import { ApiError } from './errors.mjs';
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

function createDefaultFirestore(settings) {
  if (!settings || !settings.projectId || !settings.databaseId) unavailable();
  const options = { projectId: settings.projectId, databaseId: settings.databaseId };
  if (settings.credentials) options.credentials = settings.credentials;
  if (settings.emulatorHost) {
    const separator = settings.emulatorHost.lastIndexOf(':');
    options.host = settings.emulatorHost.slice(0, separator);
    options.port = Number(settings.emulatorHost.slice(separator + 1));
    options.ssl = false;
  }
  return new Firestore(options);
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
    staffAccess: (operation, payload) => operation === 'lookup' ? getCredentials().lookup(payload).then(account => ({ account })) : notReady(),
    notifications: (operation, actor, payload) => getNotifications().execute(operation, actor, payload),
    checkoutReceipt: (actor, payload) => getSales().receipt(actor, payload),
    checkout: (actor, payload) => getSales().checkout(actor, payload),
    catalog: (operation, actor, payload) => getCatalog().execute(operation, actor, payload),
    access: (operation, payload) => {
      const service = getAccess();
      if (operation === 'start') return service.start(payload);
      if (operation === 'recover') return service.recover(payload);
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
    startOwnerAccess: payload => getAccess().start(payload),
    timings: () => Object.freeze({ calls, durationMs: Math.round(durationMs) }),
    verifyAccessEmail: payload => getAccess().email(payload),
    readAccessForPassword: payload => getAccess().read(payload),
    readAccessForPin: payload => getAccess().read(payload),
    lookupAccessLogin: payload => getCredentials().loginLookup(payload),
    prepareBiometricOptions: notReady,
    prepareAccessOptions: payload => getAccess().prepareOptions(payload),
    prepareDeviceAccess: notReady,
    prepareAccessCompletion: payload => getAccess().prepareCompletion(payload),
    reserveAuthAttempt: payload => getRateLimits().reserve(payload),
    createAuthChallenge: notReady,
    consumeAuthChallenge: notReady,
    readSession: tokenHash => getIdentity().readSession(tokenHash),
    revokeSession: tokenHash => getIdentity().revokeSession(tokenHash),
    revokeOtherSessions: tokenHash => getIdentity().revokeOtherSessions(tokenHash),
  };
}
