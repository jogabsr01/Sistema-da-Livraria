#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { loadFirestoreSettings, parseServiceAccountJson } from '../backend/firestore-config.mjs';
import { loadOwnerAccessSettings } from '../backend/owner-access.mjs';

const file = process.argv[2];
if (!file || process.argv.length !== 3) {
  console.error('Uso: node scripts/audit-firestore-production-env.mjs <arquivo-env>');
  process.exitCode = 1;
} else {
  try {
    const env = parseEnv(readFileSync(file, 'utf8'));
    const required = ['WORKSPACE_BACKEND_ENABLED', 'WORKSPACE_IDENTITY_ACCESS_ENABLED',
      'WORKSPACE_IDENTITY_SESSIONS_ENABLED', 'WORKSPACE_IDENTITY_GUARDS_ENABLED', 'WORKSPACE_IDENTITY_PASSKEYS_ENABLED'];
    const invalid = required.filter(name => env[name] !== 'true');
    if (env.APP_ENV !== 'prod') invalid.push('APP_ENV');
    if (env.WORKSPACE_STORAGE_MODE !== 'firestore') invalid.push('WORKSPACE_STORAGE_MODE');
    if (!env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON) invalid.push('WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON');
    if (invalid.length) throw new Error(`Variáveis ausentes ou inválidas: ${invalid.join(', ')}`);
    const account = parseServiceAccountJson(env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON);
    const normalized = JSON.stringify(account);
    if (normalized.includes('\n') || normalized.includes('\r')) throw new Error('JSON de credenciais não pôde ser normalizado');
    const settings = loadFirestoreSettings({ ...env, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: normalized });
    loadOwnerAccessSettings({ ...env, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: normalized });
    if (!settings.credentials) throw new Error('Credenciais de serviço ausentes');
    console.log('CONFIGURAÇÃO LOCAL VÁLIDA: modo, credenciais, flags e identidade passaram nos validadores.');
    console.log('Isto não confirma projeto implantado, permissões IAM, envio à Vercel ou acesso ao Firestore.');
  } catch (error) {
    const message = error?.code || (typeof error?.message === 'string' && error.message.startsWith('Variáveis ausentes ou inválidas:') ? error.message : 'VALIDAÇÃO_FALHOU');
    console.error(`FALHA: ${message}`);
    process.exitCode = 1;
  }
}