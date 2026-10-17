// Reversible per-user registration; never touch project settings.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findServerConfig, checkServerFiles } from './discover.mjs';

const LAUNCHER = fs.realpathSync(fileURLToPath(new URL('../bin/codex-cu-mcp', import.meta.url)));
export const INSTALL_HELP = `usage: codex-cu-mcp install [options]
  --claude            Claude Code (default: installed CLIs on PATH)
  --grok              Grok Build
  --cursor            Cursor's user MCP settings
  --claude-desktop    Claude Desktop's user MCP settings
  --name <name>       server name (default: codex-cu)
  --headless          explicitly use the app approval policy instead of elicitation
  --auto-approve <all|none|App,App>  set app policy; existing policy is preserved otherwise
  --dry-run           show destinations/command without writing
  --print-config      print mcpServers JSON for any local stdio MCP client
  --uninstall         remove only this registration (keeps package and permissions)
  -h, --help          show this help

Configuration updates preserve other servers and save a timestamped backup.
After installation: codex-cu-mcp doctor, then codex-cu-mcp demo.`;

export function parseInstallArgs(argv) {
  const options = { targets: [], name: 'codex-cu', env: {}, uninstall: false, dryRun: false, print: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--claude', '--grok', '--cursor', '--claude-desktop'].includes(a)) options.targets.push(a.slice(2));
    else if (a === '--uninstall') options.uninstall = true;
    else if (a === '--dry-run') options.dryRun = true;
    else if (a === '--print-config') options.print = true;
    else if (a === '--headless') options.env.CODEX_CU_ASK = 'never';
    else if (a === '--help' || a === '-h') options.help = true;
    else if (a === '--name' || a === '--auto-approve') {
      const value = argv[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`${a} requires a value`);
      if (a === '--name') options.name = value;
      else options.env.CODEX_CU_AUTO_APPROVE = value;
    } else throw new Error(`unknown install option: ${a}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name)) throw new Error('--name takes letters, digits, - and _');
  if (options.uninstall && (options.print || Object.keys(options.env).length)) throw new Error('--uninstall cannot be combined with registration options');
  options.targets = [...new Set(options.targets)];
  return options;
}

export function configPath(target, home = os.homedir()) {
  if (target === 'claude') return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
  if (target === 'grok') return path.join(process.env.GROK_HOME || path.join(home, '.grok'), 'config.toml');
  if (target === 'cursor') return path.join(home, '.cursor/mcp.json');
  return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
}

function onPath(cli) {
  return spawnSync('/usr/bin/which', [cli], { stdio: 'ignore' }).status === 0;
}

export function backup(file) {
  if (!fs.existsSync(file)) return;
  const dest = `${file}.codex-cu-backup-${Date.now()}-${randomUUID()}`;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dest, 0o600);
  return dest;
}

export function updateJsonConfig(file, name, registration, { uninstall = false, dryRun = false } = {}) {
  let data = {};
  const exists = fs.existsSync(file);
  if (exists) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { throw new Error(`Cannot parse ${file}; left unchanged: ${err.message}`); }
  }
  if (!data || Array.isArray(data) || typeof data !== 'object' ||
      (data.mcpServers !== undefined && (!data.mcpServers || Array.isArray(data.mcpServers) || typeof data.mcpServers !== 'object'))) {
    throw new Error(`Invalid MCP config in ${file}; left unchanged`);
  }
  const old = data.mcpServers?.[name];
  if (uninstall) {
    if (old === undefined) return { changed: false };
    delete data.mcpServers[name];
  } else {
    if (old && (typeof old !== 'object' || Array.isArray(old) || old.url || (old.type && old.type !== 'stdio'))) {
      throw new Error(`${name} in ${file} is not a local stdio server; choose a different --name`);
    }
    const next = { ...old, ...registration };
    if (old?.env || registration.env) next.env = { ...old?.env, ...registration.env };
    if (JSON.stringify(old) === JSON.stringify(next)) return { changed: false };
    data.mcpServers ??= {};
    Object.defineProperty(data.mcpServers, name, { value: next, enumerable: true, configurable: true, writable: true });
  }
  if (dryRun) return { changed: true };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const saved = backup(file);
  const temp = `${file}.codex-cu-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: exists ? fs.statSync(file).mode & 0o777 : 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
  return { changed: true, backup: saved };
}

export async function install(argv) {
  const options = parseInstallArgs(argv);
  if (options.help) { console.log(INSTALL_HELP); return; }
  const { name, targets, env, uninstall, dryRun } = options;
  if (!uninstall && LAUNCHER.includes(`${path.sep}_npx${path.sep}`)) {
    throw new Error('This is a temporary npx cache. Install a persistent copy with npm install -g <checkout-or-tarball>, then run codex-cu-mcp install.');
  }
  const registration = { type: 'stdio', command: LAUNCHER, args: [] };
  if (Object.keys(env).length) registration.env = env;
  if (options.print) { console.log(JSON.stringify({ mcpServers: { [name]: registration } }, null, 2)); return; }
  if (!targets.length) targets.push(...['claude', 'grok'].filter(onPath));
  if (!targets.length) throw new Error('No supported CLI on PATH. Use --cursor, --claude-desktop, or --print-config.');
  if (targets.includes('grok') && !onPath('grok')) throw new Error('grok is not on PATH; install Grok Build or use --print-config.');
  if (!uninstall) {
    if (process.platform !== 'darwin') throw new Error('Computer Use requires macOS and the ChatGPT desktop app.');
    const config = findServerConfig();
    const missing = checkServerFiles(config).filter(c => !c.ok);
    if (missing.length) throw new Error(`Missing ${missing.map(c => `${c.label}: ${c.file}`).join(', ')}. Open/update ChatGPT and enable Computer Use.`);
  }
  // Parse every JSON destination first so a malformed file cannot cause a partial install.
  for (const target of targets.filter(t => t !== 'grok')) updateJsonConfig(configPath(target), name, registration, { uninstall, dryRun: true });
  for (const target of targets) {
    const file = configPath(target);
    if (target !== 'grok') {
      const result = updateJsonConfig(file, name, registration, options);
      console.log(`${dryRun ? 'Would ' + (uninstall ? 'remove' : 'register') : result.changed ? (uninstall ? 'Removed' : 'Registered') : 'Already configured'} '${name}' in ${file}`);
      if (result.backup) console.log(`  Backup: ${result.backup}`);
    } else {
      const listing = spawnSync('grok', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 30_000 });
      if (listing.error || listing.status !== 0) throw new Error('Cannot inspect Grok configuration; left unchanged. Run grok mcp doctor.');
      const old = JSON.parse(listing.stdout).find(entry => entry.name === name && entry.scope === 'user');
      if (uninstall && !old) { console.log(`'${name}' is not registered in Grok user config.`); continue; }
      const mergedEnv = { ...old?.env, ...env };
      if (!uninstall && old?.command === registration.command && !(old.args?.length) &&
          Object.entries(env).every(([k, v]) => old.env?.[k] === v)) {
        console.log(`Already configured '${name}' in Grok Build`); continue;
      }
      // add replaces the entry. Preserve env and disabled state, and refuse to
      // silently discard advanced settings the CLI cannot express.
      if (!uninstall && old && Object.keys(old).some(k => !['name', 'scope', 'command', 'args', 'env', 'enabled'].includes(k))) {
        throw new Error(`Grok '${name}' has advanced settings. Update its command manually in ${file}, or choose a different --name; left unchanged.`);
      }
      const args = uninstall ? ['mcp', 'remove', name, '--scope', 'user']
        : ['mcp', 'add', name, '--scope', 'user', ...Object.entries(mergedEnv).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', registration.command];
      if (dryRun) { console.log(`${uninstall ? 'Would remove' : 'Would register'} '${name}' in ${file} (environment values omitted)`); continue; }
      // Grok's add is an upsert; don't remove the server first. Keep a recovery copy.
      const saved = backup(file);
      const result = spawnSync('grok', args, { encoding: 'utf8', timeout: 30_000 });
      if (result.error || result.status !== 0) {
        if (saved) fs.copyFileSync(saved, file);
        else fs.rmSync(file, { force: true });
        throw new Error(`Grok registration failed; restored prior config: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
      }
      if (!uninstall && old?.enabled === false) {
        const disabled = spawnSync('grok', ['mcp', 'disable', name], { encoding: 'utf8', timeout: 30_000 });
        if (disabled.error || disabled.status !== 0) {
          if (saved) fs.copyFileSync(saved, file);
          throw new Error('Could not preserve the disabled Grok server; restored prior config.');
        }
      }
      console.log(`${uninstall ? 'Removed' : 'Registered'} '${name}' in Grok Build`);
      if (saved) console.log(`  Backup: ${saved}`);
    }
  }
  if (!uninstall && !dryRun) console.log('\nRestart/reconnect your harness, then run codex-cu-mcp doctor and codex-cu-mcp demo.');
}
