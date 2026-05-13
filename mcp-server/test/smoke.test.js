// Smoke test for unruggable-launcher MCP server.
//
// Spawns mcp-server.js, sends MCP initialize + tools/list, asserts the
// expected tool surface is registered and each tool has a description +
// inputSchema. Catches accidental changes to the public MCP surface.
//
// Does NOT hit the live API — the server registers tools eagerly without
// any network calls during initialize.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, '..', 'mcp-server.js');
const SPAWN_TIMEOUT_MS = 5000;

const EXPECTED_TOOLS = [
  'get_tokenomics',
  'list_launched_tokens',
  'get_token_metadata',
  'get_factory_info',
  'check_is_reactor',
  'token_image_url',
  'unruggable_pitch',
  'reactor_chain_summary',
];

function rpcRequest(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    const stderrChunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Timed out after ${SPAWN_TIMEOUT_MS}ms. stderr:\n${stderrChunks.join('')}`));
      }
    }, SPAWN_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      let nl;
      while ((nl = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2 && msg.result) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            child.kill('SIGTERM');
            resolve(msg.result);
          }
        }
      }
    });

    child.stderr.on('data', (c) => stderrChunks.push(c.toString()));

    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(e); }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}. stderr:\n${stderrChunks.join('')}`));
      }
    });

    child.stdin.write(rpcRequest(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '0.0.0' },
    }));
    child.stdin.write(rpcRequest(2, 'tools/list', {}));
  });
}

test('mcp-server registers the full expected tool set', async () => {
  const result = await listTools();
  assert.ok(Array.isArray(result.tools), 'result.tools should be an array');
  const names = result.tools.map(t => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();
  assert.deepEqual(names, expected, 'tool set drift — update EXPECTED_TOOLS in smoke.test.js if intentional');
});

test('every tool has description + inputSchema', async () => {
  const result = await listTools();
  for (const tool of result.tools) {
    assert.ok(tool.name, 'tool missing name');
    assert.ok(tool.description, `tool ${tool.name} missing description`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `tool ${tool.name} missing inputSchema`);
    assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} schema.type should be 'object'`);
  }
});
