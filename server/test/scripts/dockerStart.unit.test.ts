import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// scripts/docker-start.sh is what the image runs. `npx` and `node` are replaced by stubs that write down how
// they were called, so no migration and no server runs. A shell script: not run on Windows, where the Docker
// image's `sh` does not exist (the image itself is Linux).
const script = path.resolve(__dirname, '../../scripts/docker-start.sh');
let bin: string;
let log: string;

function stub(name: string, body: string) {
  const file = path.join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function run(env: Record<string, string> = {}) {
  const result = spawnSync('sh', [script], {
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
    encoding: 'utf8',
  });
  const calls = (() => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  })();
  return { status: result.status, calls, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(process.platform === 'win32')('docker-start.sh', () => {
  beforeEach(() => {
    bin = mkdtempSync(path.join(tmpdir(), 'start-bin-'));
    log = path.join(bin, 'calls.log');
    stub('npx', `echo "npx $*" >> "${log}"`);
    stub('node', `echo "node $* pid=$$" >> "${log}"`);
  });

  it('only starts the server when MIGRATE_ON_START is not set', () => {
    const { status, calls } = run();

    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^node dist\/server\.js /);
  });

  it.each(['false', '1', 'yes', ''])(
    'does not migrate for MIGRATE_ON_START=%j: only the exact word true does',
    (value) => {
      const { calls } = run({ MIGRATE_ON_START: value });

      expect(calls.map((call) => call.split(' ')[0])).toEqual(['node']);
    },
  );

  it('applies the migrations first when MIGRATE_ON_START=true, and then starts the server', () => {
    const { status, calls, stdout } = run({ MIGRATE_ON_START: 'true' });

    expect(status).toBe(0);
    expect(calls[0]).toBe('npx prisma migrate deploy');
    expect(calls[1]).toMatch(/^node dist\/server\.js /);
    expect(stdout).toContain('Applying database migrations');
  });

  it('does not start the server, and exits with the failure, when a migration fails', () => {
    stub('npx', `echo "npx $*" >> "${log}"; exit 3`);

    const { status, calls } = run({ MIGRATE_ON_START: 'true' });

    expect(status).toBe(3);
    expect(calls).toEqual(['npx prisma migrate deploy']);
  });

  it('replaces the shell with node (exec), so that the stop signal of the host reaches the server', () => {
    const result = spawnSync('sh', ['-c', `sh "${script}" & child=$!; wait $child; echo "shell=$child"`], {
      env: { PATH: `${bin}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
    const shellPid = /shell=(\d+)/.exec(result.stdout)?.[1];
    const nodePid = /pid=(\d+)/.exec(readFileSync(log, 'utf8'))?.[1];

    // The same process id: the shell was replaced, not left waiting for a child.
    expect(shellPid).toBeDefined();
    expect(nodePid).toBe(shellPid);
  });
});
