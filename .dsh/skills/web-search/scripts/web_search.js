#!/usr/bin/env node
'use strict';

/**
 * 呼叫 MCP 端點（http://q.feg.cn/mcp）上的 web_search 工具。
 *
 * 此端點是 streamable-HTTP MCP 服務，因此單次搜尋需要三個 POST：
 * initialize -> 取得 mcp-session-id -> notifications/initialized -> tools/call。
 * 回應是 SSE 框架，其 `data:` 內容為 JSON-RPC；而真正的結果是另一個以字串形式
 * 存放於 result.content[0].text 的 JSON 文件。本腳本封裝了上述全部細節。
 *
 * 需求：Node.js >= 18（內建 fetch 與 node:util parseArgs），無第三方相依套件。
 *
 * 用法：
 *   node web_search.js "關鍵詞"
 *   node web_search.js -q "關鍵詞" --limit 5
 *   node web_search.js "關鍵詞" --raw       # 輸出解析後的 MCP payload
 *   node web_search.js "關鍵詞" --json      # 輸出正規化 JSON
 *   node web_search.js "關鍵詞" --quiet     # 每筆只輸出「標題<TAB>連結」
 */

const { parseArgs } = require('node:util');

const DEFAULT_ENDPOINT = process.env.MCP_WEB_SEARCH_URL || 'http://q.feg.cn/mcp';
const TIMEOUT_MS = Math.max(1, Number(process.env.MCP_WEB_SEARCH_TIMEOUT || 60)) * 1000;

const USAGE = `用法：node web_search.js [查詢詞...] [選項]

選項：
  -q, --query <文字>     查詢字串（等同位置參數寫法）
      --endpoint <網址>  MCP 端點（預設：${DEFAULT_ENDPOINT}）
      --limit <n>        最多輸出的結果筆數（預設：10）
      --json             以 JSON 輸出正規化結果
      --raw              以 JSON 輸出完整 MCP payload
      --quiet            每筆只輸出標題與連結
  -h, --help             顯示本說明

環境變數：
  MCP_WEB_SEARCH_URL      覆寫端點
  MCP_WEB_SEARCH_TIMEOUT  覆寫逾時秒數（預設：60）`;

/** MCP 傳輸層或搜尋本身失敗時擲出。 */
class McpError extends Error {}

/**
 * 送出單一 JSON-RPC 訊息。
 * @returns {Promise<{reply: object|null, sessionId: string|undefined}>}
 */
async function post(endpoint, payload, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const cause = error && error.cause ? `${error.cause.code || error.cause.message}：` : '';
    const reason = error && error.name === 'AbortError' ? `逾時（${TIMEOUT_MS}ms）` : error.message;
    throw new McpError(`無法連線至 ${endpoint}：${cause}${reason}`);
  } finally {
    clearTimeout(timer);
  }

  const nextSessionId = res.headers.get('mcp-session-id') || sessionId;
  const text = (await res.text()).trim();

  if (!res.ok) throw new McpError(`HTTP ${res.status}（來自 ${endpoint}）：${text.slice(0, 500)}`);
  // notifications/initialized 正常會回 202 與空內容。
  if (text === '') return { reply: null, sessionId: nextSessionId };
  if (text.startsWith('{')) return { reply: parseJson(text, 'JSON-RPC 回應'), sessionId: nextSessionId };

  // Streamable HTTP 也可能以 text/event-stream 框架回應。
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const chunk = trimmed.slice('data:'.length).trim();
    if (chunk !== '') return { reply: parseJson(chunk, 'SSE data 內容'), sessionId: nextSessionId };
  }
  throw new McpError(`回應中找不到 JSON-RPC payload：${text.slice(0, 500)}`);
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new McpError(`無效的${what}：${error.message} -- ${text.slice(0, 300)}`);
  }
}

/** 驗證 JSON-RPC 信封並回傳其 `result`。 */
function unwrap(reply) {
  if (!reply) throw new McpError('伺服器回應為空');
  if (reply.error) throw new McpError(`JSON-RPC 錯誤 ${reply.error.code}：${reply.error.message}`);
  if (reply.result === undefined || reply.result === null) {
    throw new McpError(`回應缺少 result：${JSON.stringify(reply).slice(0, 500)}`);
  }
  return reply.result;
}

/**
 * 執行完整握手並回傳搜尋結果
 * （organic / related_searches / base_resp）。
 */
async function callWebSearch(query, endpoint = DEFAULT_ENDPOINT) {
  const init = await post(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'web-search-skill', version: '1.0' },
    },
  });
  if (init.reply) unwrap(init.reply);

  // 不需等待結果；若伺服器為無狀態，沒有 session id 也可以。
  await post(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId);

  const call = await post(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { query } },
    },
    init.sessionId,
  );
  const result = unwrap(call.reply);

  if (result.isError) throw new McpError(`工具回報錯誤：${JSON.stringify(result).slice(0, 500)}`);

  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = blocks
    .filter((b) => b && typeof b === 'object' && (b.type === undefined || b.type === 'text') && typeof b.text === 'string')
    .map((b) => b.text);
  if (texts.length === 0) {
    throw new McpError(`工具結果沒有文字內容：${JSON.stringify(result).slice(0, 500)}`);
  }

  const payload = texts.join('\n').trim();
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    // 實際上並非雙重編碼；仍把原始文字回傳，讓呼叫端可以使用。
    return {
      organic: [],
      related_searches: [],
      base_resp: { status_code: -1, status_msg: 'unparsed' },
      raw_text: payload,
    };
  }

  const status = data.base_resp ? data.base_resp.status_code : undefined;
  if (status !== undefined && status !== null && status !== 0) {
    throw new McpError(`搜尋 API status_code=${status}：${(data.base_resp && data.base_resp.status_msg) || ''}`);
  }
  return data;
}

function formatText(data, limit) {
  const organic = (data.organic || []).slice(0, limit);
  if (organic.length === 0) return '沒有找到結果。';

  const lines = [];
  organic.forEach((item, index) => {
    lines.push(`${index + 1}. ${String(item.title || '（無標題）').trim()}`);
    const date = String(item.date || '').trim();
    if (date) lines.push(`   日期：${date}`);
    const link = String(item.link || '').trim();
    if (link) lines.push(`   ${link}`);
    const snippet = String(item.snippet || '').replace(/\s+/g, ' ').trim();
    if (snippet) lines.push(`   ${snippet.slice(0, 400)}`);
    lines.push('');
  });

  const related = (data.related_searches || []).map((r) => r && r.query).filter(Boolean);
  if (related.length > 0) lines.push(`相關搜尋：${related.join(' | ')}`);
  return lines.join('\n').trim();
}

async function main(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        query: { type: 'string', short: 'q' },
        endpoint: { type: 'string' },
        limit: { type: 'string' },
        json: { type: 'boolean', default: false },
        raw: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    process.stderr.write(`web_search：${error.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const query = (values.query || positionals.join(' ')).trim();
  if (query === '') {
    process.stderr.write('web_search：必須提供查詢字串，例如 node web_search.js "最新 AI 新聞"\n');
    return 2;
  }

  const limit = values.limit === undefined ? 10 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    process.stderr.write('web_search：--limit 必須是正整數\n');
    return 2;
  }

  let data;
  try {
    data = await callWebSearch(query, values.endpoint || DEFAULT_ENDPOINT);
  } catch (error) {
    process.stderr.write(`web_search 失敗：${error.message}\n`);
    return 1;
  }

  if (values.raw || values.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else if (values.quiet) {
    for (const item of (data.organic || []).slice(0, limit)) {
      process.stdout.write(`${item.title || ''}\t${item.link || ''}\n`);
    }
  } else {
    process.stdout.write(`${formatText(data, limit)}\n`);
  }
  return 0;
}

module.exports = { callWebSearch, formatText, McpError, DEFAULT_ENDPOINT };

// 僅在直接執行時跑 CLI，讓本模組仍可被 require() 重複使用。
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`web_search 失敗：${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    },
  );
}
