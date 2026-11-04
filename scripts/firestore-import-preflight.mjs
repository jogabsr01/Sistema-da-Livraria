import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { connect } from 'node:net';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = code => { throw Error(code); };
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const digestPattern = /^[a-f0-9]{64}$/;

export async function verifyBackup(path, expected) {
  if (!isAbsolute(path || '') || !digestPattern.test(expected || '')) fail('PREFLIGHT_BACKUP_INVALID');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 100_000_000) fail('PREFLIGHT_BACKUP_INVALID');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > 100_000_000) fail('PREFLIGHT_BACKUP_INVALID');
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (count !== stat.size || hash.digest('hex') !== expected) fail('PREFLIGHT_BACKUP_INVALID');
  } finally { await file.close(); }
}

export function probeLoopback(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000); socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
  });
}

export async function preflight(env, { probe = probeLoopback } = {}) {
  const project = env.IMPORT_PREFLIGHT_PROJECT_ID;
  // Only disposable emulator projects are currently supported; live DEV is not verified.
  if (env.IMPORT_PREFLIGHT_MODE !== 'emulator' || !projectPattern.test(project || '') || !project.startsWith('demo-') ||
      env.IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID !== project || env.IMPORT_PREFLIGHT_CONFIRM_EMULATOR !== 'YES') fail('PREFLIGHT_TARGET_DENIED');
  const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(env.FIRESTORE_EMULATOR_HOST || '');
  const port = match ? Number(match[1]) : 0;
  if (port < 1 || port > 65535) fail('PREFLIGHT_EMULATOR_INVALID');
  if (env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS) fail('PREFLIGHT_CREDENTIALS_DENIED');
  try { await verifyBackup(env.IMPORT_PREFLIGHT_BACKUP_PATH, env.IMPORT_PREFLIGHT_BACKUP_SHA256); }
  catch { fail('PREFLIGHT_BACKUP_INVALID'); }
  if (!await probe(port)) fail('PREFLIGHT_EMULATOR_UNREACHABLE');
  return { status: 'INSPECTION_ONLY', mode: 'emulator', backupHashVerified: true, loopbackPortReachable: true,
    firestoreIdentityVerified: false, backupRestorableVerified: false, simulationAuthorized: false, writePerformed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--inspect-emulator') fail('PREFLIGHT_TARGET_DENIED');
    console.log(JSON.stringify(await preflight(process.env), null, 2));
  } catch { console.error('IMPORT_PREFLIGHT_FAILED'); process.exitCode = 1; }
}