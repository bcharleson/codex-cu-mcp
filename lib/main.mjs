// All commands report actionable errors without leaking a stack to MCP stdout.
import fs from 'node:fs';
const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case undefined:
    case 'serve':
      if (args.length) throw new Error('serve takes no arguments');
      await import('./proxy.mjs');
      break;
    case 'doctor':
      if (args.some(a => a !== '--json')) throw new Error('doctor accepts only --json');
      await (await import('./commands.mjs')).doctor({ json: args.includes('--json') });
      break;
    case 'demo':
      if (args.some(a => !['--show', '--json'].includes(a))) throw new Error('demo accepts only --show and --json');
      await (await import('./commands.mjs')).demo({ show: args.includes('--show'), json: args.includes('--json') });
      break;
    case 'install':
      await (await import('./install.mjs')).install(args);
      break;
    case '--version':
    case '-v':
      console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
      break;
    default:
      await (await import('./cli.mjs')).runCli(process.argv.slice(2));
  }
} catch (err) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: err.message }));
  else console.error(`codex-cu-mcp${command ? ` ${command}` : ''}: ${err.message}`);
  process.exitCode = err.name === 'UsageError' ? 2 : 1;
}
