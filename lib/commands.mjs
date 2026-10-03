// `codex-cu-mcp doctor` and `codex-cu-mcp demo`.

import fs from 'node:fs';
import { connect } from './client.mjs';
import { DiscoveryError, findServerConfig } from './discover.mjs';

const ok = msg => console.log(`  ✔ ${msg}`);
const bad = msg => console.log(`  ✘ ${msg}`);

// js tool results start with first-use documentation; the JSON state follows it.
function lastJsonObject(text, key) {
  const start = text.lastIndexOf(`{"${key}"`);
  if (start < 0) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

export async function doctor() {
  console.log('codex-cu-mcp doctor\n');
  let failed = false;

  let config;
  try {
    config = findServerConfig();
    ok(`plugin unified-computer-use ${config.version}`);
  } catch (err) {
    if (!(err instanceof DiscoveryError)) throw err;
    bad(err.message);
    process.exit(1);
  }

  for (const [label, file] of [
    ['server runtime', config.command],
    ['server script', config.args[0]],
    ['Computer Use service', config.env.SKY_CUA_SERVICE_PATH],
  ]) {
    if (file == null) continue;
    if (fs.existsSync(file)) ok(`${label}: ${file}`);
    else {
      bad(`${label} missing: ${file}`);
      failed = true;
    }
  }

  const client = await connect();
  try {
    ok(`server ${client.init.serverInfo?.name} ${client.init.serverInfo?.version} initialized`);
    const { tools } = await client.request('tools/list', {});
    ok(`tools: ${tools.map(t => t.name).join(', ')}`);

    const state = lastJsonObject(await client.js('await cua.getState();', 'Inventory'), 'apps');
    if (state) {
      const running = state.apps.filter(a => a.isRunning).length;
      ok(`computer use: ${state.apps.length} apps visible (${running} running)`);
      if (state.browsers.length > 0) {
        ok(`browser control: ${state.browsers.map(b => b.name ?? b.id).join(', ')}`);
      } else {
        console.log(
          '  · browser control: no extension-connected browsers (install the Codex Chrome\n' +
            '    extension for tab-level control; any browser still works as a native app)',
        );
      }
      for (const e of state.errors ?? []) bad(e);
    } else {
      bad('cua.getState() returned no inventory');
      failed = true;
    }
  } finally {
    client.close();
  }

  console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

// Width and height of a PNG or JPEG screenshot, as REPL source.
const IMAGE_SIZE_JS = `function imageSize(b) {
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("unknown screenshot format");
}`;

// Works out 12 × 12 in Calculator. In the background by default; with
// show: true the window is raised and clicks are paced so the agent cursor
// can be watched gliding between buttons.
export async function demo({ show = false } = {}) {
  const client = await connect();
  try {
    console.log('Opening Calculator through Computer Use…');
    await client.js('let app = await cua.getApp("Calculator");', 'Get Calculator');
    // Background: instant element-index presses. Show: coordinate clicks, which
    // the service animates, at button positions relative to the window
    // (Calculator's basic keypad has a fixed layout).
    const clicks = show
      ? `${IMAGE_SIZE_JS}
await app.performSecondaryAction(0, "Raise");
const [w, h] = imageSize(await app.getScreenshot({ emit: false }));
const at = (fx, fy) => [Math.round(fx * w), Math.round(fy * h)];
const [ac, one, two, times, equals] = [at(0.383, 0.388), at(0.148, 0.781), at(0.383, 0.781), at(0.852, 0.518), at(0.852, 0.913)];
for (const point of [ac, one, two, times, one, two, equals]) {
  await app.click(point);
  await new Promise(r => setTimeout(r, 250));
}`
      : `const tree = await app.getAXState({ emit: false, disableDiffing: true });
const lines = tree.split("\\n");
const find = re => {
  const line = lines.find(l => re.test(l));
  if (!line) throw new Error("Calculator button not found: " + re);
  return Number(line.trim().split(" ")[0]);
};
for (const re of [/ID: AllClear/, /ID: One\\b/, /ID: Two\\b/, /button Multiply/, /ID: One\\b/, /ID: Two\\b/, /button Equals/]) {
  await app.click(find(re));
}`;
    const output = await client.js(
      `${clicks}
const after = await app.getAXState({ emit: false, disableDiffing: true });
nodeRepl.write("RESULT=" + (after.match(/Edit field, Value: ([^\\n,]+)/)?.[1] ?? "?"));`,
      'Compute 12 × 12',
    );
    const result = output.match(/RESULT=(.*)/)?.[1]?.trim();
    console.log(`12 × 12 = ${result}`);
    process.exitCode = result === '144' ? 0 : 1;
  } finally {
    client.close();
  }
}
