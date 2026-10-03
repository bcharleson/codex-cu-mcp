// Locates the newest Codex unified-computer-use plugin and its cua_repl server
// entry. Resolved on every launch so ChatGPT app updates are picked up without
// re-registering anything.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const PLUGIN_ROOT = path.join(
  CODEX_HOME,
  'plugins/cache/openai-bundled/unified-computer-use',
);

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

export class DiscoveryError extends Error {}

export function findServerConfig() {
  let versions;
  try {
    versions = fs.readdirSync(PLUGIN_ROOT);
  } catch {
    throw new DiscoveryError(
      `Codex computer-use plugin not found at ${PLUGIN_ROOT}.\n` +
        'Install the ChatGPT desktop app, open Codex, and enable Computer Use once.',
    );
  }
  versions = versions
    .filter(v => fs.existsSync(path.join(PLUGIN_ROOT, v, '.mcp.json')))
    .sort(compareVersions);
  const version = versions.at(-1);
  if (!version) {
    throw new DiscoveryError(`No plugin version with a .mcp.json under ${PLUGIN_ROOT}.`);
  }

  const file = path.join(PLUGIN_ROOT, version, '.mcp.json');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.cua_repl;
  if (!entry?.command) {
    throw new DiscoveryError(`${file} has no mcpServers.cua_repl entry.`);
  }
  return {
    version,
    file,
    command: entry.command,
    args: entry.args ?? [],
    env: entry.env ?? {},
  };
}
