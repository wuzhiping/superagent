/** Reads the tail of a DSH session log: the file is a sequence of independent zstd frames, one per flushed batch. */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const path = process.argv[2]
if (!path) { console.error('usage: read-session.mjs <session.v4.jsonl.zstd> [lines]'); process.exit(1) }
const limit = Number(process.argv[3] ?? 24)
const bytes = readFileSync(path)

// Split at the zstd magic number (0x28 0xB5 0x2F 0xFD); each frame stands alone.
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let at = bytes.indexOf(MAGIC); at >= 0; at = bytes.indexOf(MAGIC, at + 1)) starts.push(at)
let text = ''
for (let index = 0; index < starts.length; index += 1) {
  const slice = bytes.subarray(starts[index], starts[index + 1] ?? bytes.length)
  try { text += zstdDecompressSync(slice).toString('utf8') } catch { /* a partial trailing frame */ }
}
const lines = text.split('\n').filter(Boolean)
console.log(`${lines.length} events, last ${limit}:`)
for (const line of lines.slice(-limit)) {
  let event
  try { event = JSON.parse(line) } catch { console.log('?? ' + line.slice(0, 120)); continue }
  const type = event.type ?? '?'
  const at = String(event.at ?? event.time ?? '').slice(11, 19)
  let detail
  if (type === 'assistant/message') detail = (event.message?.content ?? event.content ?? []).map(part => part.text ?? part.type).join(' ')
  else if (type === 'tool/call') detail = `${event.name ?? event.tool} ${JSON.stringify(event.arguments ?? event.args ?? {})}`
  else if (type === 'tool/result') detail = JSON.stringify(event.result ?? event.content ?? '')
  else if (type === 'user/message') detail = JSON.stringify(event.message?.content ?? event.content ?? '')
  else detail = JSON.stringify(event)
  console.log(`${at} ${type}: ${String(detail).slice(0, 260)}`)
}
