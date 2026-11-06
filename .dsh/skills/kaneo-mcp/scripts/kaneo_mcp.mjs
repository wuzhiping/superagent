#!/usr/bin/env node
/**
 * Kaneo MCP CLI — https://pl.feg.cn/api/mcp
 *
 * The MCP endpoint is OAuth-protected and rejects the Kaneo API key directly.
 * This script exchanges the API key at the consent step for a 30-day bearer
 * token via OAuth 2.1 + PKCE, caches it, and then speaks MCP over the modern
 * (2026-07-28) stateless request shape.
 *
 * Key lookup order: $KANEO_MCP_KEY -> $KANEO_MCP_KEY_FILE -> <skill>/.key
 * Token cache:      <skill>/.cache/token.json (auto re-minted when stale or on 401)
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.KANEO_MCP_BASE || 'https://pl.feg.cn').replace(/\/+$/, '');
const MCP_URL = `${BASE}/api/mcp`;
const PROTOCOL = '2026-07-28';
const REDIRECT = 'http://127.0.0.1:9/callback';
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.KANEO_MCP_KEY_FILE || join(SKILL_DIR, '.key');
const TOKEN_FILE = process.env.KANEO_MCP_TOKEN_FILE || join(SKILL_DIR, '.cache', 'token.json');

const b64url = (b) => b.toString('base64url');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate-limit state, learned from response headers. Kaneo (better-auth api-key)
 * exposes: x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset (epoch s),
 * and Retry-After on 429. Reading them lets us wait exactly as long as needed
 * instead of guessing — a 429 mid-window needs up to 60s, not 3s.
 */
const rateLimit = { limit: null, remaining: null, resetAt: null };
const MAX_WAIT_MS = Number(process.env.KANEO_MCP_MAX_WAIT_MS) || 90_000;

function noteRateLimit(res) {
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(limit) && limit > 0) rateLimit.limit = limit;
  if (Number.isFinite(remaining) && remaining >= 0) rateLimit.remaining = remaining;
  if (Number.isFinite(reset) && reset > 0) {
    // Epoch seconds in practice; tolerate a relative value too.
    rateLimit.resetAt = reset >= 1e9 ? reset * 1000 : Date.now() + reset * 1000;
  }
}

/** Sleep before sending when the window is nearly exhausted, so we never burn into a 429. */
async function respectBudget() {
  if (rateLimit.remaining === null || rateLimit.resetAt === null) return;
  if (Date.now() >= rateLimit.resetAt) {
    rateLimit.remaining = null;
    rateLimit.resetAt = null;
    return;
  }
  if (rateLimit.remaining > 3) return;
  const waitMs = Math.min(rateLimit.resetAt - Date.now() + 250, MAX_WAIT_MS);
  if (waitMs <= 0) return;
  console.error(`# 配額剩 ${rateLimit.remaining}/${rateLimit.limit ?? '?'}，先等 ${Math.ceil(waitMs / 1000)} 秒至窗口重置`);
  await sleep(waitMs);
  rateLimit.remaining = null;
  rateLimit.resetAt = null;
}

function retryAfterMs(res) {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return at - Date.now();
  }
  if (rateLimit.resetAt) return rateLimit.resetAt - Date.now();
  return null;
}

/**
 * Fetch with 429 handling: proactive budget check, then header-driven backoff.
 * The response body is left unconsumed for the caller.
 */
async function fetchWithRetry(makeRequest, attempts = 6) {
  for (let attempt = 0; ; attempt++) {
    await respectBudget();
    const res = await makeRequest();
    noteRateLimit(res);
    if (res.status !== 429) return res;
    if (attempt >= attempts - 1) {
      console.error(`# 429 未解除（已重試 ${attempts - 1} 次）。可稍後再跑，或為不同用途各配一把 API key。`);
      return res;
    }
    const fromHeaders = retryAfterMs(res);
    const waitMs = Math.min(
      fromHeaders && fromHeaders > 0 ? fromHeaders + 250 : Math.min(3000 * 2 ** attempt, 30_000),
      MAX_WAIT_MS,
    );
    console.error(
      `# 429 速率限制（${rateLimit.limit ?? 100} 次/分，剩 ${rateLimit.remaining ?? '?'}），` +
        `等 ${Math.ceil(waitMs / 1000)} 秒重試（第 ${attempt + 1}/${attempts - 1} 次）`,
    );
    await sleep(waitMs);
  }
}

/** Per-process column cache — board/tasks both need /column/{projectId}. */
const columnCache = new Map();
async function getColumns(projectId, ttlMs = 60_000) {
  const hit = columnCache.get(projectId);
  if (hit && Date.now() - hit.at < ttlMs) return hit.columns;
  const columns = (await restApi('GET', `/column/${projectId}`)) ?? [];
  columnCache.set(projectId, { at: Date.now(), columns });
  return columns;
}

/** Exit without letting undici's open sockets abort the process. */
class Exit extends Error {
  constructor(code) {
    super('exit');
    this.code = code;
  }
}
const die = (message, code = 1) => {
  console.error(message);
  throw new Exit(code);
};

const readText = (file) => readFileSync(file, 'utf8').replace(/^\uFEFF+/, '');

function apiKey() {
  if (process.env.KANEO_MCP_KEY) return process.env.KANEO_MCP_KEY.trim();
  if (existsSync(KEY_FILE)) return readText(KEY_FILE).trim();
  throw new Error(
    `No Kaneo API key configured.\n` +
      `  Provide your own (Kaneo → Settings → API keys), then run:\n` +
      `    node <this script> key <your-kaneo-api-key>\n` +
      `  or set KANEO_MCP_KEY / KANEO_MCP_KEY_FILE. Expected at: ${KEY_FILE}`,
  );
}

async function readJson(res) {
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const body = line ? line.slice(5).trim() : text;
  try {
    return { status: res.status, json: JSON.parse(body) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

/** OAuth 2.1 PKCE: register client -> authorize -> approve with API key -> exchange code. */
function tokenCache() {
  try {
    return JSON.parse(readText(TOKEN_FILE));
  } catch {
    return null;
  }
}

/**
 * OAuth 2.1 PKCE, step 1: register a public client and open an authorization request.
 * Returns the consent URL the human opens, plus the PKCE state needed to finish.
 */
async function beginAuthorization(redirectUri = REDIRECT, state = randomUUID()) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  const registration = await readJson(
    await fetch(`${MCP_URL}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'dsh',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    }),
  );
  const clientId = registration.json?.client_id;
  if (!clientId) die(`client registration failed: ${registration.status} ${JSON.stringify(registration.json ?? registration.text)}`);

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const authorize = await fetch(`${MCP_URL}/authorize?${query}`, { redirect: 'manual' });
  const location = authorize.headers.get('location');
  const requestId = location && new URL(location).searchParams.get('request_id');
  if (!requestId) die(`authorize failed: ${authorize.status} ${location}`);

  return { clientId, verifier, redirectUri, requestId, state, consentUrl: location };
}

/** Best-effort: hand the consent URL to the desktop browser. Failure is harmless. */
function openBrowser(url) {
  const commands = [
    ['cmd', ['/c', 'start', '', url]],
    ['open', [url]],
    ['xdg-open', [url]],
  ];
  for (const [command, args] of commands) {
    try {
      spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch {}
  }
  return false;
}

/**
 * First-time login (and the only path that works with no session at all).
 *
 * Runs a loopback callback server, registers that exact redirect URI, opens the
 * browser, and waits for Kaneo to redirect back with the authorization code —
 * the same flow Claude Desktop and other MCP clients use. No copy-pasting.
 */
async function browserLogin(timeoutMs = 10 * 60_000) {
  const { createServer } = await import('node:http');
  const state = randomUUID();
  let settle;
  const callback = new Promise((resolve) => {
    settle = resolve;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
      code
        ? '<meta charset="utf-8"><h3>登入完成，可以關閉這個分頁。</h3>'
        : `<meta charset="utf-8"><h3>授權未完成：${error ?? 'no code'}</h3>`,
    );
    settle({ code, error, state: url.searchParams.get('state') });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const authorization = await beginAuthorization(redirectUri, state);
  const stateFile = join(SKILL_DIR, '.cache', 'login.json');
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify(
      { clientId: authorization.clientId, verifier: authorization.verifier, redirectUri, requestId: authorization.requestId },
      null,
      2,
    ),
  );

  console.log(`已在瀏覽器開啟 Kaneo 授權頁（若沒開，請手動貼上）：\n  ${authorization.consentUrl}\n`);
  openBrowser(authorization.consentUrl);
  console.log('請在頁面上按「核准」…');

  const timer = setTimeout(() => settle({ code: null, error: 'timeout' }), timeoutMs);
  const result = await callback;
  clearTimeout(timer);
  server.close();

  if (!result.code) {
    die(
      `未取得授權碼（${result.error}）。state 已存在 ${stateFile}，可改用：\n` +
        `  login --complete "<瀏覽器網址列上那條 http://127.0.0.1:.../callback?code=... >"`,
    );
  }
  if (result.state !== state) die('state 不符，可能不是本次授權的回呼，已中止');
  const token = await exchangeCode({ clientId: authorization.clientId, verifier: authorization.verifier, redirectUri, code: result.code });
  rmSync(stateFile, { force: true });
  return token;
}

/**
 * Step 2: approve the pending consent request.
 *
 * The consent endpoint authenticates a *session*, never the API key: upstream
 * `getUserSession` deletes `x-api-key` before calling getSession, so an API key
 * is rejected with 401. Credentials are tried in order:
 *   1. the session token we already hold — this is what makes renewal self-sustaining
 *      (each renewal hands back a fresh 30-day session), and
 *   2. the API key, for servers that still accept it at this step.
 */
async function approveConsent(requestId) {
  const credentials = [];
  const session = tokenCache()?.access_token;
  if (session) credentials.push({ label: 'existing session token', headers: { authorization: `Bearer ${session}` } });
  credentials.push({ label: 'API key', headers: { 'x-api-key': apiKey() } });

  let lastError = 'no credential';
  for (const credential of credentials) {
    const res = await fetch(`${MCP_URL}/authorize/request/${requestId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...credential.headers },
      body: JSON.stringify({ approved: true }),
    });
    const body = await readJson(res);
    const code = res.ok ? new URL(body.json.redirect).searchParams.get('code') : null;
    if (code) return code;
    lastError = `${credential.label}: ${res.status} ${JSON.stringify(body.json ?? body.text)}`;
  }
  die(
    `consent failed (${lastError}).\n` +
      `The stored session token is gone or expired. Mint a new one in a browser:\n` +
      `  node <this script> login          # open the printed URL, approve, then\n` +
      `  node <this script> login --complete "<the redirect URL from the address bar>"`,
  );
}

/** Step 3: exchange the authorization code and cache the resulting session token. */
async function exchangeCode({ clientId, verifier, redirectUri, code }) {
  const grant = await readJson(
    await fetch(`${MCP_URL}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    }),
  );
  if (!grant.json?.access_token) die(`token exchange failed: ${grant.status} ${JSON.stringify(grant.json ?? grant.text)}`);

  const record = {
    access_token: grant.json.access_token,
    expires_at: new Date(Date.now() + (grant.json.expires_in ?? 0) * 1000).toISOString(),
  };
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(record, null, 2));
  return record.access_token;
}

async function mintToken() {
  const authorization = await beginAuthorization();
  const code = await approveConsent(authorization.requestId);
  return exchangeCode({ ...authorization, code });
}

function cachedToken() {
  const record = tokenCache();
  if (record?.access_token && new Date(record.expires_at) - Date.now() > 5 * 60_000) return record.access_token;
  return null;
}

const getToken = async () => cachedToken() || (await mintToken());

const envelope = () => ({
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'dsh', version: '1.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
});

async function rpc(method, params, name, token) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': PROTOCOL,
    'mcp-method': method,
  };
  if (name) headers['mcp-name'] = name;
  const res = await fetchWithRetry(() =>
    fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: envelope() } }),
    }),
  );
  return readJson(res);
}

/**
 * MCP call credential order.
 *
 * Since the 2026-10-16 redeploy `/api/mcp` accepts the Kaneo API key as a bearer
 * token, verified identical to an OAuth session across every read tool except
 * `whoami` (which reads the better-auth session object and returns null).
 * A stored OAuth session stays as the fallback for older deployments.
 */
async function call(method, params, name) {
  const credentials = [{ label: 'API key', token: apiKey() }];
  const session = cachedToken();
  if (session) credentials.push({ label: 'OAuth session', token: session });

  let rejected = 'no credential';
  for (const credential of credentials) {
    const out = await rpc(method, params, name, credential.token);
    if (out.status === 401 || out.status === 403) {
      rejected = `${credential.label}: ${out.status} ${JSON.stringify(out.json ?? out.text)}`;
      continue;
    }
    if (out.json?.error) die(JSON.stringify(out.json.error, null, 2));
    if (!out.json) die(`HTTP ${out.status}: ${out.text}`);
    return out.json.result;
  }

  // Everything stored was rejected — mint a fresh OAuth session and retry once.
  console.error(`# stored credentials rejected (${rejected}); falling back to a fresh OAuth login`);
  const out = await rpc(method, params, name, await mintToken());
  if (out.json?.error) die(JSON.stringify(out.json.error, null, 2));
  if (!out.json) die(`HTTP ${out.status}: ${out.text}`);
  return out.json.result;
}

/**
 * Identity. The MCP `whoami` tool reads the better-auth session, which an API
 * key does not have (it returns `null`), so fall back to the REST identity.
 */
async function identity() {
  const viaMcp = await toolText('whoami');
  if (viaMcp) return viaMcp;
  const session = await restApi('GET', '/auth/get-session');
  return session?.user ?? session;
}

/** Current rate-limit budget for the API key (read from response headers). */
async function quota() {
  // /api/config is public and returns zeroed headers, so probe an authenticated,
  // side-effect-free endpoint instead.
  const res = await fetch(`${BASE}/api/auth/api-key/list`, { headers: { 'x-api-key': apiKey() } });
  await res.text();
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const resetAt = Number.isFinite(reset) && reset > 0 ? (reset >= 1e9 ? reset * 1000 : Date.now() + reset * 1000) : null;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt,
    resetInSeconds: resetAt ? Math.max(0, Math.round((resetAt - Date.now()) / 1000)) : null,
    windowSeconds: 60,
  };
}

async function toolText(name, args = {}) {
  const result = await call('tools/call', { name, arguments: args }, name);
  return (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => {
      try {
        return JSON.parse(block.text);
      } catch {
        return block.text;
      }
    })
    .at(0);
}

const HELP = `Kaneo CLI — MCP tools + the REST API behind them

MCP (${MCP_URL})
  key [<api-key>]               show, or store and verify, your Kaneo API key
  quota                         current rate-limit budget (limit/remaining/reset)
  tools [--json]                list available tools
  call <tool> [json]            call a tool (or --args-file <path>)
  whoami                        signed-in Kaneo user
  workspaces                    list workspaces
  token [--refresh]             print the cached bearer token (optionally re-mint)
  login                         browser login: opens Kaneo, catches the callback
  login --redirect <uri>        same, but print the URL for a manual paste
  login --complete <redirect>   finish a manual login with the redirect URL

REST (${BASE}/api, authenticates with .key)
  board <projectId>                                     per-column task counts
  tasks <projectId> [--column <name|slug>] [--all]      tasks in a column, by name or slug
  columns list <projectId>
  columns create <projectId> <json>      {name, icon?, color?, isFinal?}
  columns update <columnId> <json>       {name?, icon?, color?, isFinal?}
  columns reorder <projectId> <json>     {columns:[{id,position}]}
  columns delete <columnId> --yes
  workflow list <projectId>
  workflow set <projectId> <json>        {integrationType, eventType, columnId}
  workflow delete <ruleId> --yes
  rest <METHOD> <path> [json]            escape hatch, e.g. rest GET /custom-field/project/<id>

Common flags
  --args-file <path>            read the JSON argument from a file
  --raw                         print the raw MCP result envelope (call only)
  --yes                         confirm a destructive REST command`;

/**
 * Parse a JSON argument from --args-file, or from the remaining positional args.
 * PowerShell eats inline quotes, so --args-file is the reliable path.
 */
function jsonArg(positional, flags) {
  if (typeof flags['args-file'] === 'string') return JSON.parse(readText(flags['args-file']));
  const inline = positional.join(' ').trim();
  return inline ? JSON.parse(inline) : {};
}

/** Kaneo REST API (the same API the MCP wraps) — authenticates with an API key. */
async function restApi(method, path, body, key = apiKey()) {
  const url = `${BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method,
      headers: {
        'x-api-key': key,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? parsed.message
        : typeof parsed === 'string' && parsed
          ? parsed.slice(0, 300)
          : `HTTP ${res.status}`;
    die(`${method} ${path} -> ${res.status}: ${detail}`);
  }
  return parsed;
}

const print = (value) => {
  if (value === null || value === undefined || value === '') console.log('OK');
  else console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

const requireYes = (flags, what) => {
  if (!flags.yes) die(`${what} is destructive; re-run with --yes to confirm`, 2);
};

function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(argv[i]);
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = positional;

  switch (command) {
    case 'tools': {
      const { tools } = await call('tools/list', {});
      if (flags.json) {
        console.log(JSON.stringify(tools, null, 2));
        break;
      }
      for (const tool of tools) {
        console.log(`${tool.name}\n    ${(tool.description || '').split('\n')[0]}`);
        for (const [key, prop] of Object.entries(tool.inputSchema?.properties ?? {})) {
          const required = (tool.inputSchema.required ?? []).includes(key) ? ' (required)' : '';
          console.log(`      ${key}${required}: ${prop.type ?? 'any'} ${prop.description ?? ''}`.trimEnd());
        }
      }
      console.log(`\n${tools.length} tools`);
      break;
    }
    case 'call': {
      const tool = rest[0];
      if (!tool) die('usage: call <tool> [json] [--args-file <path>]', 2);
      let args = {};
      if (typeof flags['args-file'] === 'string') args = JSON.parse(readText(flags['args-file']));
      else if (rest.length > 1) args = JSON.parse(rest.slice(1).join(' '));
      const result = await call('tools/call', { name: tool, arguments: args }, tool);
      if (flags.raw) console.log(JSON.stringify(result, null, 2));
      else for (const block of result.content ?? []) console.log(block.type === 'text' ? block.text : JSON.stringify(block));
      if (result.isError) process.exitCode = 1;
      break;
    }
    case 'key': {
      const provided = rest[0];
      if (!provided) {
        const fromEnv = process.env.KANEO_MCP_KEY;
        const fromFile = existsSync(KEY_FILE);
        if (!fromEnv && !fromFile) {
          die(`no API key configured.\nProvide your own: node <this script> key <your-kaneo-api-key>\n(expected at ${KEY_FILE})`, 2);
        }
        const key = apiKey();
        console.log(`source : ${fromEnv ? '$KANEO_MCP_KEY' : KEY_FILE}\nkey    : …${key.slice(-4)} (${key.length} chars)`);
        break;
      }

      // Verify the supplied key on its own (no fallback to a stored session),
      // and only persist it once it proves itself — a typo must not clobber a good key.
      const candidate = provided.trim();
      const probe = await rpc('tools/list', {}, undefined, candidate);
      if (probe.status !== 200 || probe.json?.error) {
        die(`key rejected by ${MCP_URL}: ${probe.status} ${JSON.stringify(probe.json ?? probe.text)}`);
      }
      if (process.env.KANEO_MCP_KEY && process.env.KANEO_MCP_KEY.trim() !== candidate) {
        console.error(`# warning: $KANEO_MCP_KEY is set and takes precedence over ${KEY_FILE}`);
      }
      mkdirSync(dirname(KEY_FILE), { recursive: true });
      writeFileSync(KEY_FILE, `${candidate}\n`);
      console.log(`key ok (${probe.json.result.tools.length} tools) → written to ${KEY_FILE}`);
      const restSession = await restApi('GET', '/auth/get-session', undefined, candidate);
      console.log(`REST: ${restSession?.user?.name ?? '(no session)'} / ${restSession?.user?.email ?? '?'}`);
      break;
    }
    case 'quota':
      print(await quota());
      break;
    case 'whoami':
      console.log(JSON.stringify(await identity(), null, 2));
      break;
    case 'workspaces':
      console.log(JSON.stringify(await toolText('list_workspaces'), null, 2));
      break;
    case 'token':
      if (flags.refresh) await mintToken();
      console.log(await getToken());
      break;
    case 'board': {
      // Column-by-column counts. list_tasks answers pagination.total for a status
      // filter, so one cheap request per column gives an exact board overview.
      const [projectId] = rest;
      if (!projectId) die('usage: board <projectId> [--json]', 2);
      const columns = await getColumns(projectId);
      const rows = [];
      for (const column of columns) {
        const page = await toolText('list_tasks', { projectId, status: column.slug, limit: 1 });
        rows.push({ name: column.name, slug: column.slug, isFinal: Boolean(column.isFinal), count: page?.pagination?.total ?? 0 });
      }
      if (flags.json) {
        print(rows);
        break;
      }
      const width = Math.max(6, ...rows.map((row) => row.name.length));
      console.log(`${''.padEnd(width)}  ${'slug'.padEnd(12)} count`);
      for (const row of rows) {
        console.log(`${(row.isFinal ? '*' : ' ') + row.name.padEnd(width - 1)}  ${row.slug.padEnd(12)} ${String(row.count).padStart(5)}`);
      }
      console.log(`${'total'.padEnd(width)}  ${''.padEnd(12)} ${String(rows.reduce((sum, row) => sum + row.count, 0)).padStart(5)}`);
      break;
    }
    case 'tasks': {
      // Column filter by NAME or slug. list_tasks only accepts a slug and answers
      // an unknown value with a silent empty page, so resolve names here first.
      const [projectId] = rest;
      if (!projectId) die('usage: tasks <projectId> [--column <name|slug>] [--limit N] [--all] [--page N] [--json]', 2);
      const columns = await getColumns(projectId);
      let status;
      if (typeof flags.column === 'string') {
        const wanted = flags.column.trim().toLowerCase();
        const matches = columns.filter((c) => c.slug.toLowerCase() === wanted || (c.name ?? '').toLowerCase() === wanted);
        const available = columns.map((c) => `${c.name}(${c.slug})`).join(', ');
        if (matches.length === 0) die(`no column "${flags.column}" in this project.\nAvailable: ${available}`, 2);
        if (matches.length > 1) die(`"${flags.column}" is ambiguous: ${matches.map((c) => `${c.name}(${c.slug})`).join(', ')}`, 2);
        status = matches[0].slug;
      }
      const args = { projectId, limit: Number(flags.limit) || 20 };
      if (status) args.status = status;
      const page = Number(flags.page) || 1;
      const collect = (result) => [
        ...(result?.data?.columns ?? []).flatMap((column) => (column.tasks ?? []).map((task) => ({ ...task, column: column.name }))),
        ...(result?.data?.archivedTasks ?? []).map((task) => ({ ...task, column: '(archived)' })),
      ];
      const first = await toolText('list_tasks', { ...args, page });
      let tasks = collect(first);
      if (flags.all) {
        const pages = first?.pagination?.totalPages ?? 1;
        for (let next = page + 1; next <= pages; next++) {
          tasks = tasks.concat(collect(await toolText('list_tasks', { ...args, page: next })));
        }
        const seen = new Set();
        tasks = tasks.filter((task) => (seen.has(task.id) ? false : (seen.add(task.id), true)));
      }
      if (flags.json) {
        print(tasks);
        break;
      }
      console.log(
        `${status ? `column ${status}` : 'all columns'} — showing ${tasks.length} of ${first?.pagination?.total ?? '?'}` +
          `${flags.all ? '' : ` (page ${page}/${first?.pagination?.totalPages ?? 1}; add --all for every page)`}`,
      );
      for (const task of tasks) {
        console.log(
          `#${String(task.number ?? '?').padEnd(4)} [${task.column}] ${(task.priority ?? '-').padEnd(4)} ${task.dueDate ? task.dueDate.slice(0, 10) : 'no-due   '} ${(task.assigneeName ?? 'unassigned').padEnd(10)} ${task.title}`,
        );
      }
      break;
    }
    case 'columns': {
      const [action, id, ...tail] = rest;
      if (!action || !id) die('usage: columns list|create|update|reorder|delete <id> [json]', 2);
      switch (action) {
        case 'list':
          print(await restApi('GET', `/column/${id}`));
          break;
        case 'create':
          print(await restApi('POST', `/column/${id}`, jsonArg(tail, flags)));
          break;
        case 'update':
          print(await restApi('PUT', `/column/${id}`, jsonArg(tail, flags)));
          break;
        case 'reorder':
          print(await restApi('PUT', `/column/reorder/${id}`, jsonArg(tail, flags)));
          break;
        case 'delete':
          requireYes(flags, `deleting column ${id}`);
          print(await restApi('DELETE', `/column/${id}`));
          break;
        default:
          die(`unknown columns action: ${action} (list|create|update|reorder|delete)`, 2);
      }
      break;
    }
    case 'workflow': {
      const [action, id, ...tail] = rest;
      if (!action || !id) die('usage: workflow list|set|delete <projectId|ruleId> [json]', 2);
      switch (action) {
        case 'list':
          print(await restApi('GET', `/workflow-rule/${id}`));
          break;
        case 'set':
          print(await restApi('PUT', `/workflow-rule/${id}`, jsonArg(tail, flags)));
          break;
        case 'delete':
          requireYes(flags, `deleting workflow rule ${id}`);
          print(await restApi('DELETE', `/workflow-rule/${id}`));
          break;
        default:
          die(`unknown workflow action: ${action} (list|set|delete)`, 2);
      }
      break;
    }
    case 'rest': {
      const [method, path, ...tail] = rest;
      if (!method || !path) die('usage: rest <METHOD> <path> [json]', 2);
      const verb = method.toUpperCase();
      const hasBody = tail.length > 0 || typeof flags['args-file'] === 'string';
      print(await restApi(verb, path, hasBody ? jsonArg(tail, flags) : undefined));
      break;
    }
    case 'login': {
      const stateFile = join(SKILL_DIR, '.cache', 'login.json');
      if (flags.complete === true) die('--complete needs the redirect URL from the browser address bar', 2);
      if (typeof flags.complete === 'string') {
        let state = null;
        try {
          state = JSON.parse(readText(stateFile));
        } catch {}
        if (!state) die(`no pending login state at ${stateFile}; run \`login\` first`, 2);
        const code = flags.complete.includes('code=') ? new URL(flags.complete).searchParams.get('code') : flags.complete;
        if (!code) die('could not read a code from --complete', 2);
        const token = await exchangeCode({ ...state, code });
        rmSync(stateFile, { force: true });
        console.log(`token stored (${token.slice(0, 8)}…, expires ${tokenCache()?.expires_at})`);
        break;
      }
      if (typeof flags.redirect === 'string') {
        const authorization = await beginAuthorization(flags.redirect);
        mkdirSync(dirname(stateFile), { recursive: true });
        writeFileSync(
          stateFile,
          JSON.stringify(
            { clientId: authorization.clientId, verifier: authorization.verifier, redirectUri: authorization.redirectUri, requestId: authorization.requestId },
            null,
            2,
          ),
        );
        console.log(
          `請用瀏覽器開啟並按核准：\n  ${authorization.consentUrl}\n\n` +
            `完成後執行：\n  node kaneo_mcp.mjs login --complete "<瀏覽器網址列那條 URL>"`,
        );
        break;
      }
      await browserLogin();
      console.log(`登入完成，token 已存入 ${TOKEN_FILE}\nexpires: ${tokenCache()?.expires_at}`);
      break;
    }
    case 'help':
    case undefined:
      console.log(HELP);
      break;
    default:
      die(`unknown command: ${command}\n\n${HELP}`, 2);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Exit) process.exitCode = error.code;
  else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
