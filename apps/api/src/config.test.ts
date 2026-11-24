import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('blank staff passphrase and session secret fall back to development defaults', () => {
  const output = execFileSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    "const { config, isUsingDefaultSecrets } = await import('./src/config.ts'); console.log(JSON.stringify({ passphrase: config.staffPassphrase, secretSet: config.sessionSecret.length > 0, isUsingDefaultSecrets }));",
  ], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, STAFF_PASSPHRASE: '', SESSION_SECRET: '' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)!), {
    passphrase: 'garage',
    secretSet: true,
    isUsingDefaultSecrets: true,
  });
});
