// Command-line access to every Computer Use action, for agents and scripts
// that don't speak MCP. Each invocation starts a fresh server session, binds
// the app, performs one action and prints the resulting accessibility state.

import fs from 'node:fs';
import { connect } from './client.mjs';

export const USAGE = `usage: codex-cu-mcp <command> [options]

Server
  serve                                  run the stdio MCP server (default)
  doctor                                 check the install
  demo                                   12 × 12 in Calculator, in the background

Discover
  apps                                   list apps (running and recent)
  state <app>                            print the app's accessibility tree
  screenshot <app> [-o file.png]         capture the app's window

Act (element indices come from \`state\`; x,y are window coordinates)
  click <app> <index|x,y> [--right] [--double]
  type <app> <text>                      type into the focused element
  key <app> <key>                        press a key, e.g. Return, cmd+a
  paste <app> <text>                     paste text (clipboard is restored)
  set <app> <index> <value>              set an element's value
  scroll <app> <index|x,y> <up|down|left|right> [pages]
  drag <app> <x1,y1> <x2,y2>
  action <app> <index> <name>            secondary action, e.g. Raise, Expand
  raise <app>                            bring the window forward
  js <code> [--app <app>]                run cua REPL code (\`app\` is bound when --app is set)

Options
  --show       raise the window first so you can watch the agent cursor
  --quiet      don't print the accessibility state after an action`;

function parseFlags(argv) {
  const flags = { show: false, quiet: false, right: false, double: false, out: null, app: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--show') flags.show = true;
    else if (a === '--quiet') flags.quiet = true;
    else if (a === '--right') flags.right = true;
    else if (a === '--double') flags.double = true;
    else if (a === '-o' || a === '--out') flags.out = argv[++i];
    else if (a === '--app') flags.app = argv[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

// "12" -> 12, "300,140" -> [300, 140]
function target(value) {
  if (value == null) throw new UsageError('missing target');
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new UsageError(`expected an element index or x,y: ${value}`);
  return [Number(m[1]), Number(m[2])];
}

class UsageError extends Error {}

const q = JSON.stringify;

// The first js call of a session must be exactly one entry call.
async function bindApp(client, app) {
  return client.js(`let app = await cua.getApp(${q(app)});`, `Get ${app}`);
}

// Codex's first-use result is long documentation followed by the UI state.
function stripDocs(text) {
  const i = text.lastIndexOf('\nWindow: ');
  return i >= 0 ? text.slice(i + 1) : text;
}

function need(rest, n, what) {
  if (rest.length < n) throw new UsageError(`missing ${what}`);
}

export async function runCli(argv) {
  const [command, ...args] = argv;
  const { flags, rest } = parseFlags(args);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  let action;
  switch (command) {
    case 'apps': {
      const client = await connect();
      try {
        const text = await client.js('await cua.getState();', 'Inventory');
        const start = text.lastIndexOf('{"apps"');
        const state = JSON.parse(text.slice(start));
        for (const app of state.apps) {
          console.log(`${app.isRunning ? '●' : '○'} ${app.displayName ?? app.id}  (${app.id})`);
        }
      } finally {
        client.close();
      }
      return;
    }
    case 'state':
      need(rest, 1, '<app>');
      action = null;
      break;
    case 'screenshot':
      need(rest, 1, '<app>');
      action = 'await app.getScreenshot();';
      break;
    case 'click': {
      need(rest, 2, '<app> <index|x,y>');
      const opts = {};
      if (flags.right) opts.mouseButton = 'right';
      if (flags.double) opts.clickCount = 2;
      action = `await app.click(${q(target(rest[1]))}, ${q(opts)});`;
      break;
    }
    case 'type':
      need(rest, 2, '<app> <text>');
      action = `await app.typeText(${q(rest.slice(1).join(' '))});`;
      break;
    case 'key':
      need(rest, 2, '<app> <key>');
      action = `await app.pressKey(${q(rest[1])});`;
      break;
    case 'paste':
      need(rest, 2, '<app> <text>');
      action = `await app.paste(${q(rest.slice(1).join(' '))});`;
      break;
    case 'set':
      need(rest, 3, '<app> <index> <value>');
      action = `await app.setValue(${q(target(rest[1]))}, ${q(rest.slice(2).join(' '))});`;
      break;
    case 'scroll':
      need(rest, 3, '<app> <index|x,y> <direction>');
      action = `await app.scroll(${q(target(rest[1]))}, ${q(rest[2])}${rest[3] ? `, ${Number(rest[3])}` : ''});`;
      break;
    case 'drag':
      need(rest, 3, '<app> <x1,y1> <x2,y2>');
      action = `await app.drag(${q(target(rest[1]))}, ${q(target(rest[2]))});`;
      break;
    case 'action':
      need(rest, 3, '<app> <index> <name>');
      action = `await app.performSecondaryAction(${q(target(rest[1]))}, ${q(rest.slice(2).join(' '))});`;
      break;
    case 'raise':
      need(rest, 1, '<app>');
      action = 'await app.performSecondaryAction(0, "Raise");';
      break;
    case 'js': {
      need(rest, 1, '<code>');
      const client = await connect();
      try {
        if (flags.app) await bindApp(client, flags.app);
        const { text, images } = await client.call(rest.join(' '), 'Run code');
        if (text) console.log(stripDocs(text));
        images.forEach((img, i) => saveImage(img, flags.out, i));
      } finally {
        client.close();
      }
      return;
    }
    default:
      throw new UsageError(`unknown command: ${command}`);
  }

  const app = rest[0];
  const client = await connect();
  try {
    const initial = await bindApp(client, app);
    if (action == null) {
      console.log(stripDocs(initial));
      return;
    }
    if (flags.show && command !== 'raise') {
      await client.js(
        'await app.performSecondaryAction(0, "Raise"); await new Promise(r => setTimeout(r, 400));',
        'Raise window',
      );
    }
    const observe = command === 'screenshot' || flags.quiet ? '' : '\nawait app.getAXState();';
    const { text, images } = await client.call(action + observe, `${command} ${app}`);
    if (text) console.log(stripDocs(text));
    images.forEach((img, i) => saveImage(img, flags.out, i));
  } finally {
    client.close();
  }
}

function saveImage(buffer, out, index) {
  const file = out
    ? index === 0 ? out : out.replace(/(\.\w+)?$/, `-${index}$1`)
    : `codex-cu-${Date.now()}${index ? `-${index}` : ''}.png`;
  fs.writeFileSync(file, buffer);
  console.log(`saved ${file}`);
}

export { UsageError };
