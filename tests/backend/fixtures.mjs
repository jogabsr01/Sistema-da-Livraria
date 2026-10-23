import { randomBytes } from 'node:crypto';
export const properties = { APP_ENV: 'dev', INSTALLATION_ID: '5e2602f6-006d-48ea-82a1-9ad198416810', SIGNING_SECRET: randomBytes(32).toString('hex'), OWNER_EMAIL: 'owner@example.invalid' };
const authenticatedAt = Date.now() - 1000;
export const actor = () => ({ id: '61180f9f-dcea-4a02-b3b3-823c4a4eb7e3', role: 'ADMIN', assurance: 'mfa', authenticatedAt, sessionTokenHash: 'f1'.repeat(32) });
export function environment(extra = {}) { return { WORKSPACE_BACKEND_ENABLED: 'true', APP_ENV: 'dev', CONTEXT: 'branch-deploy', BRANCH: 'dev', DEPLOY_PRIME_URL: 'https://dev--merry-chimera-49a1f3.netlify.app', WORKSPACE_INSTALLATION_ID: properties.INSTALLATION_ID, WORKSPACE_HMAC_SECRET: properties.SIGNING_SECRET, WORKSPACE_SPREADSHEET_ID: 'sheet_'.padEnd(30, 's'), WORKSPACE_DRIVE_ROOT_ID: 'root_'.padEnd(30, 'r'), WORKSPACE_SCRIPT_URL: 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec', ...extra }; }
