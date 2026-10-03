// Entry point for bin/codex-cu-mcp.

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined:
  case 'serve':
    await import('./proxy.mjs');
    break;
  case 'doctor':
    await (await import('./commands.mjs')).doctor();
    break;
  case 'demo':
    await (await import('./commands.mjs')).demo({ show: args.includes('--show') });
    break;
  default: {
    const { runCli, UsageError, USAGE } = await import('./cli.mjs');
    try {
      await runCli(process.argv.slice(2));
    } catch (err) {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${USAGE}`);
        process.exit(2);
      }
      console.error(`codex-cu-mcp: ${err.message}`);
      process.exit(1);
    }
  }
}
