import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyStdio } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport as LegacyHTTP } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const args = ['--import', './__tests__/fixtures/shopify-fetch.mjs', 'dist/index.js',
  '--domain=test-shop.myshopify.com', '--accessToken=test-token'];
const env = { PATH: process.env.PATH, HOME: process.env.HOME, SHOPIFY_API_VERSION: '2026-01' };
const info = { name: 'compatibility-test', version: '1.0.0' };
const modernOptions = { versionNegotiation: { mode: { pin: '2026-07-28' } } };

async function verifyTools(client, readOnly, remote) {
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name).sort();
  assert.ok(names.includes('get-locations'));
  assert.equal(names.includes('update-product'), !readOnly);
  assert.equal(names.includes('upload-local-file'), !readOnly && !remote);
  assert.equal(names.includes('create-file-upload-session'), !readOnly && remote);
  const result = await client.callTool({ name: 'get-locations', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).locations[0].name, 'Test warehouse');
  const invalid = await client.callTool({ name: 'get-locations', arguments: { limit: 'bad' } });
  assert.equal(invalid.isError, true);
  if (readOnly) {
    // Listing alone is insufficient: a caller must not invoke a hidden write.
    await assert.rejects(client.callTool({ name: 'update-product', arguments: { id: '1' } }));
  }
  return tools;
}

for (const readOnly of [false, true]) {
  test(`stdio old and July 2026 clients, readOnly=${readOnly}`, { timeout: 20000 }, async () => {
    const catalogs = [];
    for (const modern of [false, true]) {
      const Transport = modern ? StdioClientTransport : LegacyStdio;
      const transport = new Transport({ command: process.execPath,
        args: [...args, ...(readOnly ? ['--read-only'] : [])], env, stderr: 'pipe' });
      const client = modern ? new Client(info, modernOptions) : new LegacyClient(info);
      try {
        await client.connect(transport);
        if (modern) {
          assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
          assert.ok(await client.discover());
        }
        catalogs.push(await verifyTools(client, readOnly, false));
      } finally { await client.close(); }
    }
    assert.deepEqual(catalogs[0], catalogs[1]);
  });
}

async function startRemote(readOnly, key = 'test-key') {
  const child = spawn(process.execPath, [...args, '--remote', ...(readOnly ? ['--read-only'] : [])], {
    env: { ...env, PORT: '0', MCP_API_KEY: key, MCP_ALLOWED_ORIGINS: 'https://client.example',
      PUBLIC_BASE_URL: 'https://public.example', MCP_ALLOWED_HOSTS: 'custom.example' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let logs = '';
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${logs}`)), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Exited ${code}: ${logs}`)); });
    child.stderr.on('data', chunk => {
      logs += chunk;
      const match = logs.match(/Health: (http:\/\/(?:localhost|127\.0\.0\.1):\d+)\/health/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  }).catch(error => { child.kill('SIGKILL'); throw error; });
  return { url, listeningAddress: logs.match(/Listening address: (.+)/)?.[1], async close() {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { const [code, signal] = await exited; assert.equal(signal, null); assert.equal(code, 0); }
    finally { clearTimeout(timer); }
  } };
}

for (const readOnly of [false, true]) {
  test(`remote SSE, old HTTP and July 2026 HTTP, readOnly=${readOnly}`, { timeout: 30000 }, async () => {
    const server = await startRemote(readOnly);
    const catalogs = [];
    try {
      for (const kind of ['sse', 'legacy-http', 'modern-http', 'auto-http']) {
        const url = new URL(`${server.url}/mcp?apiKey=test-key`);
        const modern = kind.endsWith('http') && !kind.startsWith('legacy');
        const transport = kind === 'sse' ? new SSEClientTransport(url) :
          modern ? new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
            requestInit: { headers: { Authorization: 'Bearer test-key' } },
          }) : new LegacyHTTP(url);
        const client = modern ? new Client(info, kind === 'auto-http'
          ? { versionNegotiation: { mode: 'auto' } } : modernOptions) : new LegacyClient(info);
        try {
          await client.connect(transport);
          if (modern) {
          assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
          assert.ok(await client.discover());
        }
          catalogs.push(await verifyTools(client, readOnly, true));
        } finally { await client.close(); }
      }
      for (const catalog of catalogs.slice(1)) assert.deepEqual(catalogs[0], catalog);
    } finally { await server.close(); }
  });
}

test('HTTP authentication, host/origin validation, protocol errors and unknown legacy sessions', { timeout: 20000 }, async () => {
  const server = await startRemote(true);
  try {
    assert.equal((await fetch(`${server.url}/health`)).status, 200);
    // Use node:http to send the actual Host header consistently across Node versions.
    const hostStatus = (path, method, host, extraHeaders = {}) => new Promise((resolve, reject) => {
      const req = request(`${server.url}${path}`, {
        method, setHost: false, headers: { Host: host, ...extraHeaders },
      }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.on('error', reject);
      req.end();
    });
    for (const path of ['/mcp', '/messages']) {
      for (const host of ['evil.example', 'localhost.attacker.example', 'localhost@evil.example', 'localhost/evil', '']) {
        // No Origin or credentials: Host validation must run before authentication.
        assert.equal(await hostStatus(path, 'POST', host), 403, `Rejected Host: ${host}`);
        assert.equal(await hostStatus(path, 'OPTIONS', host), 403);
      }
      assert.equal(await hostStatus(path, 'OPTIONS', 'evil.example', { 'X-Forwarded-Host': 'public.example' }), 403);
      for (const host of ['public.example', 'custom.example:8080', 'LOCALHOST', '127.0.0.1', '[::1]:3000']) {
        assert.equal(await hostStatus(path, 'POST', host), 401);
        assert.equal(await hostStatus(path, 'OPTIONS', host, { Origin: 'https://client.example' }), 200);
        assert.equal(await hostStatus(path, 'OPTIONS', host, { Origin: 'https://evil.example' }), 403);
      }
    }
    for (const [path, method] of [['/mcp', 'GET'], ['/mcp', 'POST'], ['/mcp', 'DELETE'], ['/messages', 'POST']]) {
      for (const key of ['', '?apiKey=wrong']) {
        assert.equal((await fetch(`${server.url}${path}${key}`, { method })).status, 401);
      }
    }
    assert.equal((await fetch(`${server.url}/mcp?apiKey=test-key`, {
      method: 'POST', headers: { Authorization: 'Bearer wrong' },
    })).status, 401);
    for (const origin of ['https://evil.example', 'null', 'http://localhost.attacker.example']) {
      assert.equal((await fetch(`${server.url}/mcp?apiKey=test-key`, {
        method: 'POST', headers: { Origin: origin },
      })).status, 403);
    }
    const allowed = await fetch(`${server.url}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://client.example', 'Access-Control-Request-Headers': 'authorization,mcp-method,mcp-param-example' } });
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.equal(allowed.headers.get('Access-Control-Allow-Headers'), 'authorization,mcp-method,mcp-param-example');
    assert.equal((await fetch(`${server.url}/messages?apiKey=test-key&sessionId=unknown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).status, 404);
    for (const protocolVersion of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
      const response = await fetch(`${server.url}/mcp?apiKey=test-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion, capabilities: {}, clientInfo: info } }),
      });
      assert.equal(response.status, 200);
      const wire = await response.text();
      const data = wire.split('\n').find(line => line.startsWith('data: '));
      const result = JSON.parse(data ? data.slice(6) : wire).result;
      assert.equal(result.protocolVersion, protocolVersion);
      assert.equal(result.resultType, undefined);
      assert.equal(response.headers.get('mcp-session-id'), null);
    }
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    } } };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer test-key', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' };
    const response = await fetch(`${server.url}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text());
    const json = await response.json();
    assert.equal(json.result.resultType, 'complete');
    assert.equal(json.result.ttlMs, 0);
    assert.equal(json.result.cacheScope, 'private');
    assert.ok(json.result.tools);
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(`${server.url}/mcp`, { method, headers });
      assert.equal(response.status, 405);
    }
    const missingHeader = { ...headers };
    delete missingHeader['Mcp-Method'];
    const missing = await fetch(`${server.url}/mcp`, { method: 'POST',
      headers: missingHeader, body: JSON.stringify(body) });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, -32020);
    const mismatch = await fetch(`${server.url}/mcp`, { method: 'POST',
      headers: { ...headers, 'Mcp-Method': 'tools/call' }, body: JSON.stringify(body) });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error.code, -32020);
  } finally { await server.close(); }
});

test('no-key development setup remains usable on loopback', { timeout: 15000 }, async () => {
  const server = await startRemote(false, '');
  const client = new Client(info, modernOptions);
  try {
    assert.equal(new URL(server.url).hostname, '127.0.0.1');
    assert.equal(server.listeningAddress, '127.0.0.1');
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
    await verifyTools(client, false, true);
  } finally { await client.close(); await server.close(); }
});
