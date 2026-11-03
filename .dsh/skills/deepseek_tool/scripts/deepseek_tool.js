#!/usr/bin/env node
'use strict';

/**
 * 呼叫 MCP 端點（http://q.feg.cn/sse）上的 DeepSeek Scout 服務。
 * 支援兩個工具：
 *   - deepseek_search：真實網路搜尋，回結構化結果
 *   - deepseek_fetch ：抓單一網頁，以 Markdown 格式回傳
 *
 * 此端點是 streamable-HTTP MCP，需要三個 POST：
 * initialize -> 取 mcp-session-id -> notifications/initialized -> tools/call。
 * 回應是 SSE 框架（event: message + data: {...}），其 `result.content[0].text`
 * 為另一個 JSON 字串（需第二次解析）。
 *
 * 需求：Node.js >= 18（內建 fetch 與 node:util parseArgs），無第三方相依套件。
 *
 * 用法：
 *   node deepseek_tool.js search "查詢詞"
 *   node deepseek_tool.js search "查詢詞" --count 5 --localization "CN"
 *   node deepseek_tool.js search "查詢詞" --need-content --json
 *   node deepseek_tool.js fetch  "https://example.com/article"
 *   node deepseek_tool.js fetch  "https://example.com/article" --raw
 */

const { parseArgs } = require('node:util');

const DEFAULT_ENDPOINT = process.env.MCP_DEEPSEEK_URL || 'http://q.feg.cn/sse';
const TIMEOUT_MS = Math.max(1, Number(process.env.MCP_DEEPSEEK_TIMEOUT || 60)) * 1000;

const USAGE = `用法：node deepseek_tool.js <子命令> [參數...] [選項]

子命令：
  search <查詢詞>      真實網路搜尋
  fetch  <url>         抓單一網頁（Markdown 格式）

search 選項：
  -c, --count <n>      結果筆數 1–50（預設 10）
      --ori-question <q>  觸發搜尋的使用者原始問題（協助理解意圖）
      --localization <ip>  偏好的本地化 IP，例如 CN、US
      --need-content      在 content 欄位回傳完整正文
      --json              輸出正規化 JSON
      --raw               輸出完整 MCP payload（除錯用）
      --quiet             每筆只輸出「標題<TAB>連結」
      --endpoint <url>    MCP 端點

fetch 選項：
      --json              輸出 { url, markdown } 結構化 JSON
      --raw               輸出完整 MCP payload
      --endpoint <url>    MCP 端點

通用選項：
  -h, --help            顯示本說明

環境變數：
  MCP_DEEPSEEK_URL      覆寫端點
  MCP_DEEPSEEK_TIMEOUT  覆寫逾時秒數（預設 60）`;

/** MCP 傳輸層或工具本身失敗時擲出。 */
class McpError extends Error {}

/**
 * 送出單一 JSON-RPC 訊息。
 * @param {string} endpoint
 * @param {object} payload
 * @param {string|undefined} sessionId
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
  if (text === '') return { reply: null, sessionId: nextSessionId };
  if (text.startsWith('{')) return { reply: parseJson(text, 'JSON-RPC 回應'), sessionId: nextSessionId };

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

function unwrap(reply) {
  if (!reply) throw new McpError('伺服器回應為空');
  if (reply.error) throw new McpError(`JSON-RPC 錯誤 ${reply.error.code}：${reply.error.message}`);
  if (reply.result === undefined || reply.result === null) {
    throw new McpError(`回應缺少 result：${JSON.stringify(reply).slice(0, 500)}`);
  }
  return reply.result;
}

/**
 * 從 result.content[] 抽出所有文字區塊，組合成單一字串。
 * 對 search / fetch 都適用。
 */
function collectText(result) {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = blocks
    .filter((b) => b && typeof b === 'object' && (b.type === undefined || b.type === 'text') && typeof b.text === 'string')
    .map((b) => b.text);
  return texts.join('\n').trim();
}

/**
 * 對 endpoint 完成 initialize + notifications/initialized，
 * 回傳可重用的 sessionId。
 */
async function initSession(endpoint) {
  const init = await post(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'deepseek-tool-skill', version: '1.0' },
    },
  });
  if (init.reply) unwrap(init.reply);
  await post(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId);
  return init.sessionId;
}

/**
 * 執行深搜並回傳正規化結果。
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.count]
 * @param {string} [options.oriQuestion]
 * @param {string} [options.localization]
 * @param {boolean} [options.needContent]
 * @param {string} [options.endpoint]
 */
async function callSearch(query, options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const sessionId = await initSession(endpoint);

  const args = { query };
  if (options.count !== undefined) args.count = options.count;
  if (options.oriQuestion) args.ori_question = options.oriQuestion;
  if (options.localization) args.localization = options.localization;
  if (options.needContent) args.need_content = true;

  const call = await post(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'deepseek_search', arguments: args },
    },
    sessionId,
  );
  const result = unwrap(call.reply);
  if (result.isError) throw new McpError(`工具回報錯誤：${JSON.stringify(result).slice(0, 500)}`);

  const text = collectText(result);
  if (text === '') {
    return { results: [], raw: { result } };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { results: [], raw_text: text };
  }
  return data;
}

/**
 * 抓取單一網頁並回傳 Markdown 內容。
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
async function callFetch(url, options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const sessionId = await initSession(endpoint);

  const call = await post(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'deepseek_fetch', arguments: { url } },
    },
    sessionId,
  );
  const result = unwrap(call.reply);
  if (result.isError) throw new McpError(`工具回報錯誤：${JSON.stringify(result).slice(0, 500)}`);

  const text = collectText(result);
  // fetch 結果也是 JSON 字串，常見格式為 {"title":"...","content":"<markdown>"}
  if (text === '') return { url, markdown: '', title: null };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return {
        url,
        title: typeof parsed.title === 'string' ? parsed.title : null,
        markdown: typeof parsed.content === 'string' ? unescapeMarkdown(parsed.content) : text,
      };
    }
  } catch {
    // 不是 JSON 編碼，直接當 Markdown 文字
  }
  return { url, title: null, markdown: unescapeMarkdown(text) };
}

/**
 * 清除 server 端過度跳脫的常見 Markdown 字符（\/、\,、\.、\#、\!、\?、\;、\:、\(、\)）。
 * 這是 DeepSeek 內部 markdown→JSON 序列化器留下的多餘反斜線。
 */
function unescapeMarkdown(s) {
  if (typeof s !== 'string') return s;
  // 清除 server 端過度跳脫的字元（\/、\,、\.、\#、\!、\?、\;、\:、\(、\)、\[、\]、\{、\}、\|、\>、\<、\=、\—、\–、\-、\〜、\&）
  return s.replace(/\\([/,.#!?:;()\[\]{}|>_<=\-—–~&*`+"'])/g, '$1');
}

function formatSearch(data, limit) {
  const results = (data.results || []).slice(0, limit);
  if (results.length === 0) return '沒有找到結果。';

  const lines = [];
  results.forEach((item, index) => {
    lines.push(`${index + 1}. ${String(item.title || '（無標題）').trim()}`);
    const site = String(item.site_name || '').trim();
    const date = String(item.date || '').trim();
    const meta = [site, date].filter(Boolean).join(' · ');
    if (meta) lines.push(`   ${meta}`);
    const link = String(item.url || '').trim();
    if (link) lines.push(`   ${link}`);
    const snippet = String(item.snippet || item.summary || '').replace(/\s+/g, ' ').trim();
    if (snippet) lines.push(`   ${snippet.slice(0, 400)}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function formatFetch(data) {
  if (!data.markdown) return '（空內容）';
  return data.markdown;
}

async function main(argv) {
  // 第一個位置參數是子命令
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return argv.length === 0 ? 2 : 0;
  }
  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (subcommand !== 'search' && subcommand !== 'fetch') {
    process.stderr.write(`deepseek_tool：未知的子命令 "${subcommand}"。\n\n${USAGE}\n`);
    return 2;
  }

  // 為 search 定義完整 options；fetch 僅需要 endpoint + json + raw
  const searchOptions = {
    query: { type: 'string' },
    count: { type: 'string' },
    'ori-question': { type: 'string' },
    localization: { type: 'string' },
    'need-content': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    endpoint: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  };
  const fetchOptions = {
    json: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
    endpoint: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  };
  const optionConfig = subcommand === 'search' ? searchOptions : fetchOptions;

  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: optionConfig,
    }));
  } catch (error) {
    process.stderr.write(`deepseek_tool：${error.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const endpoint = values.endpoint || DEFAULT_ENDPOINT;

  if (subcommand === 'search') {
    const query = (values.query || positionals.join(' ')).trim();
    if (query === '') {
      process.stderr.write('deepseek_tool search：必須提供查詢字串，例如 node deepseek_tool.js search "最新 AI 新聞"\n');
      return 2;
    }
    const count = values.count === undefined ? 10 : Number(values.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      process.stderr.write('deepseek_tool：--count 必須是 1–50 之間的整數\n');
      return 2;
    }

    let data;
    try {
      data = await callSearch(query, {
        count,
        oriQuestion: values['ori-question'],
        localization: values.localization,
        needContent: values['need-content'],
        endpoint,
      });
    } catch (error) {
      process.stderr.write(`deepseek_tool search 失敗：${error.message}\n`);
      return 1;
    }

    if (values.raw) {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else if (values.json) {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else if (values.quiet) {
      for (const item of (data.results || []).slice(0, count)) {
        process.stdout.write(`${item.title || ''}\t${item.url || ''}\n`);
      }
    } else {
      process.stdout.write(`${formatSearch(data, count)}\n`);
    }
    return 0;
  }

  if (subcommand === 'fetch') {
    const url = (positionals[0] || '').trim();
    if (url === '') {
      process.stderr.write('deepseek_tool fetch：必須提供 URL，例如 node deepseek_tool.js fetch "https://example.com"\n');
      return 2;
    }
    if (!/^https?:\/\//i.test(url)) {
      process.stderr.write('deepseek_tool fetch：URL 必須以 http:// 或 https:// 開頭\n');
      return 2;
    }

    let data;
    try {
      data = await callFetch(url, { endpoint });
    } catch (error) {
      process.stderr.write(`deepseek_tool fetch 失敗：${error.message}\n`);
      return 1;
    }

    if (values.raw) {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else if (values.json) {
      process.stdout.write(`${JSON.stringify({ url: data.url, title: data.title, markdown: data.markdown }, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatFetch(data)}\n`);
    }
    return 0;
  }
}

module.exports = { callSearch, callFetch, formatSearch, formatFetch, McpError, DEFAULT_ENDPOINT };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`deepseek_tool 失敗：${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    },
  );
}
