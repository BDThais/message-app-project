import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverDirectory = resolve(import.meta.dirname, '..');
const composeFile = resolve(serverDirectory, 'docker-compose.test.yml');
const testEnvFile = resolve(serverDirectory, '.env.test');
const testDatabaseUrl = 'postgresql://chatapp_test:chatapp_test@localhost:55432/chatapp_test';
const prismaCli = resolve(serverDirectory, 'node_modules/prisma/build/index.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: serverDirectory,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertTestDatabase() {
  if (!existsSync(testEnvFile)) {
    throw new Error('Missing server/.env.test. Copy server/.env.test.example to server/.env.test first.');
  }

  const envText = readFileSync(testEnvFile, 'utf8');
  const databaseLine = envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (databaseLine !== testDatabaseUrl) {
    throw new Error(`Refusing to modify a database other than ${testDatabaseUrl}.`);
  }
}

const action = process.argv[2];
if (!['up', 'down', 'deploy', 'reset'].includes(action)) {
  throw new Error('Usage: node scripts/test-db.mjs <up|down|deploy|reset>');
}

if (action === 'up') {
  run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait']);
} else if (action === 'down') {
  run('docker', ['compose', '-f', composeFile, 'down']);
} else {
  assertTestDatabase();
  if (action === 'deploy') {
    run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    });
  } else {
    run(process.execPath, [prismaCli, 'migrate', 'reset', '--force', '--skip-seed'], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    });
  }
}