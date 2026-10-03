// Minimal MCP stdio client used by `codex-cu-mcp doctor` and `codex-cu-mcp demo`.
// It launches the same command an MCP client would (bin/codex-cu-mcp), so a
// passing check exercises the full launcher -> proxy -> server chain.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'codex-cu-mcp');

export async function connect({ timeoutMs = 120_000 } = {}) {
  const child = spawn(LAUNCHER, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (message.method == null && waiter) {
        pending.delete(message.id);
        waiter(message);
      }
    }
  });

  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));

  function request(method, params) {
    const id = ++nextId;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const response = new Promise(resolve => pending.set(id, resolve));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs} ms`)), timeoutMs).unref(),
    );
    const died = exited.then(code => {
      throw new Error(`server exited (code ${code}) during ${method}`);
    });
    return Promise.race([response, timeout, died]).then(message => {
      if (message.error) throw new Error(`${method}: ${message.error.message}`);
      return message.result;
    });
  }

  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'codex-cu-mcp-cli', version: '1.0.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  return {
    init,
    request,
    // Runs code in the cua REPL; returns { text, images } (images as Buffers).
    async call(code, title) {
      const result = await request('tools/call', {
        name: 'js',
        arguments: { code, title, timeout_ms: 90_000 },
      });
      const content = result.content ?? [];
      const text = content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
      if (result.isError) throw new Error(text.split('\n')[0] || 'js tool call failed');
      const images = content
        .filter(c => c.type === 'image')
        .map(c => Buffer.from(c.data, 'base64'));
      return { text, images };
    },
    async js(code, title) {
      return (await this.call(code, title)).text;
    },
    close() {
      child.kill();
    },
  };
}
