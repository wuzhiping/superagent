import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const root = 'D:/Refine/Books/ntop/AI/dsh/sessions'
const wanted = process.argv[2] ?? ''
const directories = readdirSync(root).filter(name => name.includes(wanted))
for (const directory of directories) {
  const files = readdirSync(join(root, directory)).filter(name => name.endsWith('.zstd'))
  for (const file of files) {
    const path = join(root, directory, file)
    const text = zstdDecompressSync(readFileSync(path)).toString('utf8')
    const lines = text.split('\n').filter(Boolean)
    console.log(`=== ${directory} / ${file} (${lines.length} lines) ===`)
    for (const line of lines.slice(-Number(process.argv[3] ?? 8))) {
      let entry
      try { entry = JSON.parse(line) } catch { console.log(line.slice(0, 300)); continue }
      const role = entry.role ?? entry.type ?? entry.kind ?? '?'
      const content = JSON.stringify(entry.content ?? entry.text ?? entry.message ?? entry.summary ?? '').slice(0, 400)
      console.log(`[${entry.timestamp ?? entry.time ?? ''}] ${role}: ${content}`)
    }
  }
}
