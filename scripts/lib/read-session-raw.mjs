/** Prints the raw tail of a DSH session log, so a reader can see the real event shape and the last actions. */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const path = process.argv[2]
const limit = Number(process.argv[3] ?? 6)
const bytes = readFileSync(path)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let at = bytes.indexOf(MAGIC); at >= 0; at = bytes.indexOf(MAGIC, at + 1)) starts.push(at)
let text = ''
for (let index = 0; index < starts.length; index += 1) {
  try { text += zstdDecompressSync(bytes.subarray(starts[index], starts[index + 1] ?? bytes.length)).toString('utf8') } catch { /* partial */ }
}
const lines = text.split('\n').filter(Boolean)
for (const line of lines.slice(-limit)) console.log(line.slice(0, 1500), '\n')
