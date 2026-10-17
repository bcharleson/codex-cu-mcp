import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateJsonConfig, parseInstallArgs } from '../lib/install.mjs';
const registration = { type: 'stdio', command: '/test/path with spaces/cu', args: [] };
function file(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'config.json');
}
test('installer preserves other config, app policy, and backs up exact original', t => {
  const f = file(t);
  const old = { other: true, mcpServers: { other: { command: 'other' }, 'codex-cu': { command: 'old', env: { CODEX_CU_AUTO_APPROVE: 'none' } } } };
  fs.writeFileSync(f, JSON.stringify(old));
  const result = updateJsonConfig(f, 'codex-cu', registration);
  assert.equal(fs.readFileSync(result.backup, 'utf8'), JSON.stringify(old));
  const actual = JSON.parse(fs.readFileSync(f));
  assert.deepEqual(actual.mcpServers.other, old.mcpServers.other);
  assert.equal(actual.other, true);
  assert.equal(actual.mcpServers['codex-cu'].env.CODEX_CU_AUTO_APPROVE, 'none');
  assert.equal(updateJsonConfig(f, 'codex-cu', registration).changed, false);
});
test('uninstall removes only the named entry; absent entry is idempotent', t => {
  const f = file(t);
  updateJsonConfig(f, 'codex-cu', registration);
  updateJsonConfig(f, 'other', registration);
  updateJsonConfig(f, 'codex-cu', registration, { uninstall: true });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f)).mcpServers), ['other']);
  assert.equal(updateJsonConfig(f, 'codex-cu', registration, { uninstall: true }).changed, false);
});
test('dry-run and malformed JSON never mutate config', t => {
  const f = file(t);
  updateJsonConfig(f, 'codex-cu', registration, { dryRun: true });
  assert.equal(fs.existsSync(f), false);
  fs.writeFileSync(f, '{malformed');
  assert.throws(() => updateJsonConfig(f, 'codex-cu', registration), /left unchanged/);
  assert.equal(fs.readFileSync(f, 'utf8'), '{malformed');
});
test('installer validates options and handles help', () => {
  for (const args of [['--name'], ['--wat'], ['--auto-approve'], ['--name', '../bad'], ['--uninstall', '--headless']]) assert.throws(() => parseInstallArgs(args));
  assert.equal(parseInstallArgs(['--help']).help, true);
  assert.deepEqual(parseInstallArgs(['--claude', '--claude']).targets, ['claude']);
});
test('remote registration collision is not overwritten', t => {
  const f = file(t); fs.writeFileSync(f, JSON.stringify({ mcpServers: { 'codex-cu': { type: 'http', url: 'https://example.com' } } }));
  assert.throws(() => updateJsonConfig(f, 'codex-cu', registration), /different --name/);
});
