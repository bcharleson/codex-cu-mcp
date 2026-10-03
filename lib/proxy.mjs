// codex-cu-mcp proxy.
//
// Runs the computer-use MCP server that ships with the ChatGPT desktop app
// (the "cua_repl" entry of Codex's bundled unified-computer-use plugin) and
// relays newline-delimited JSON-RPC between it and any MCP client.
//
// Codex talks to this server with a few extras that other clients don't send.
// The proxy fills them in:
//   1. Turn metadata: browser control rejects calls without
//      _meta["x-codex-turn-metadata"] = { session_id, turn_id }.
//   2. App consent: every app is gated by an elicitation such as
//      'Allow Computer Use to use "Calculator"?'. Clients that support
//      elicitation see the prompt (once per app per session); clients that
//      don't (or CODEX_CU_ASK=never) get the CODEX_CU_AUTO_APPROVE policy.
//   3. Tool surface: only the tools Codex itself enables are listed.
//   4. Cursor motion: the js tool description asks agents to click at
//      screenshot coordinates, which the service animates (CODEX_CU_GLIDE).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DiscoveryError, findServerConfig } from './discover.mjs';

const EXPOSED_TOOLS = new Set(splitList(process.env.CODEX_CU_TOOLS ?? 'js,js_reset'));
// 'all' (default), 'none', or a comma-separated list of app display names.
const AUTO_APPROVE = (process.env.CODEX_CU_AUTO_APPROVE ?? 'all').trim();
// 'client' (default): ask through the client when it supports elicitation.
// 'never': never ask the client, apply AUTO_APPROVE. Needed for headless runs
// (e.g. `grok -p`) whose client advertises elicitation but can't answer it.
const ASK = (process.env.CODEX_CU_ASK ?? 'client').trim();
const VERBOSE = process.env.CODEX_CU_VERBOSE === '1';
// Glide mode (default on): tell agents to click at screenshot coordinates.
// Element-index clicks are instant accessibility presses, so the agent cursor
// jumps; coordinate clicks are simulated pointer clicks that the Computer Use
// service animates, which is what makes Codex's cursor move like a hand.
const GLIDE = process.env.CODEX_CU_GLIDE !== '0';

// Some clients (e.g. Grok's tool search) only surface the start of a tool
// description, so the key rule leads and the details follow at the end.
const GLIDE_LEAD =
  'Click with screenshot coordinates — `await app.getScreenshot()` then `await app.click([x, y])` — so the on-screen cursor glides like a human hand (element-index clicks make it jump). ';

const GLIDE_GUIDANCE = `

## Cursor motion

Click with screenshot coordinates so the on-screen agent cursor glides to each target like a human hand, as it does in Codex:

\`\`\`javascript
await app.getScreenshot();      // locate the target in this image
await app.click([x, y]);        // x, y in that screenshot's pixels
\`\`\`

Clicking by element index (\`app.click(42)\`) is an instant accessibility press and the cursor jumps instead, so use element indices for reading state, \`setValue\`, \`selectText\` and secondary actions, and coordinates for clicks, double-clicks and drags. Take a fresh screenshot whenever the layout may have changed. The cursor is drawn over the target window: when the user wants to watch, first bring it forward with \`await app.performSecondaryAction(0, "Raise")\`.`;

const APP_CONSENT = /^Allow Computer Use to use "(.+)"\?$/;

function splitList(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function log(message) {
  process.stderr.write(`[codex-cu] ${message}\n`);
}

function lineReader(stream, onMessage) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log(`dropping non-JSON line: ${line.slice(0, 200)}`);
        continue;
      }
      onMessage(message);
    }
  });
}

function send(stream, message) {
  stream.write(JSON.stringify(message) + '\n');
}

let config;
try {
  config = findServerConfig();
} catch (err) {
  if (!(err instanceof DiscoveryError)) throw err;
  log(err.message);
  process.exit(1);
}
if (VERBOSE) log(`using unified-computer-use ${config.version} (${config.file})`);

const server = spawn(config.command, config.args, {
  env: { ...process.env, ...config.env },
  stdio: ['pipe', 'pipe', 'inherit'],
});

server.on('error', err => {
  log(`failed to start server: ${err.message}`);
  process.exit(1);
});
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => server.kill(sig));
}

const turnMetadata = { session_id: randomUUID(), turn_id: randomUUID() };
let clientSupportsElicitation = false;
const toolsListRequests = new Set();
let initializeRequestId;
const forwardedConsents = new Map(); // server request id -> app name
const approvedApps = new Set(); // apps approved for this session

// Client -> server
lineReader(process.stdin, message => {
  if (message.method === 'initialize') {
    initializeRequestId = message.id;
    const capabilities = (message.params.capabilities ??= {});
    clientSupportsElicitation = capabilities.elicitation != null;
    // The proxy always handles elicitation, so advertise it to the server.
    capabilities.elicitation = { ...(capabilities.elicitation ?? {}), form: {} };
    if (VERBOSE) log(`client elicitation support: ${clientSupportsElicitation}`);
  } else if (message.method === 'tools/list') {
    toolsListRequests.add(message.id);
  } else if (message.method === 'tools/call') {
    const params = (message.params ??= {});
    const meta = (params._meta ??= {});
    meta['x-codex-turn-metadata'] ??= turnMetadata;
  } else if (message.method == null && forwardedConsents.has(message.id)) {
    // Client's answer to a consent prompt we forwarded.
    const app = forwardedConsents.get(message.id);
    forwardedConsents.delete(message.id);
    if (message.result?.action === 'accept') {
      approvedApps.add(app);
      message.result._meta = { persist: 'session', ...(message.result._meta ?? {}) };
    }
  }
  send(server.stdin, message);
});
process.stdin.on('end', () => server.stdin.end());

// Server -> client
lineReader(server.stdout, message => {
  if (message.method === 'elicitation/create') {
    handleElicitation(message);
    return;
  }
  const isResponse = message.method == null;
  if (GLIDE && isResponse && message.id === initializeRequestId && message.result != null) {
    initializeRequestId = undefined;
    message.result.instructions = [message.result.instructions, GLIDE_LEAD.trim()].filter(Boolean).join('\n\n');
  }
  if (isResponse && toolsListRequests.has(message.id)) {
    toolsListRequests.delete(message.id);
    if (Array.isArray(message.result?.tools)) {
      message.result.tools = message.result.tools.filter(t => EXPOSED_TOOLS.has(t.name));
      if (GLIDE) {
        for (const tool of message.result.tools) {
          if (tool.name === 'js') tool.description = GLIDE_LEAD + (tool.description ?? '') + GLIDE_GUIDANCE;
        }
      }
    }
  }
  send(process.stdout, message);
});

function handleElicitation(message) {
  const prompt = message.params?.message ?? '';
  const app = prompt.match(APP_CONSENT)?.[1];

  if (app != null && approvedApps.has(app)) {
    reply(message.id, true);
    return;
  }
  if (clientSupportsElicitation && ASK !== 'never') {
    if (app != null) forwardedConsents.set(message.id, app);
    send(process.stdout, message);
    return;
  }
  const approve = autoApproves(app);
  log(`${approve ? 'auto-approved' : 'declined'}: ${prompt} (CODEX_CU_AUTO_APPROVE=${AUTO_APPROVE})`);
  if (approve && app != null) approvedApps.add(app);
  reply(message.id, approve);
}

function autoApproves(app) {
  if (AUTO_APPROVE === 'all') return true;
  if (AUTO_APPROVE === 'none' || app == null) return false;
  return splitList(AUTO_APPROVE).some(name => name.toLowerCase() === app.toLowerCase());
}

function reply(id, approve) {
  send(server.stdin, {
    jsonrpc: '2.0',
    id,
    result: approve
      ? { action: 'accept', content: {}, _meta: { persist: 'session' } }
      : { action: 'decline' },
  });
}
