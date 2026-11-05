/**
 * Renames the product in prose: the task board is called **Kanban** everywhere a reader sees it. Code identifiers, file
 * names, config keys and inline code spans keep their spelling, because they are the machine's names, not the product's.
 *
 *   node scripts/lib/rename-kanban.mjs [--dry]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PRODUCT = [/\bKanEO\b/g, /\bKaneo\b/g]
const REPLACEMENT = 'Kanban'

/** Rewrites the product name in one text, leaving inline code (`...`) and fenced blocks untouched. */
export function renameInProse (text) {
  const lines = []
  let fenced = false
  let fenceMarker = ''
  for (const line of text.split('\n')) {
    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (!fenced) { fenced = true; fenceMarker = fence[1][0] }
      else if (fence[1][0] === fenceMarker) fenced = false
      lines.push(line)
      continue
    }
    if (fenced) { lines.push(line); continue }
    // Split on inline code spans so `KanEO` inside backticks survives.
    lines.push(line.split(/(`[^`]*`)/g).map(part => part.startsWith('`') && part.endsWith('`')
      ? part : PRODUCT.reduce((acc, pattern) => acc.replace(pattern, REPLACEMENT), part)).join(''))
  }
  return lines.join('\n')
}

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'lib' || name === 'artifacts') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, out)
    else if (/\.(md|html)$/.test(name)) out.push(path)
  }
  return out
}

if (process.argv[1] && process.argv[1].endsWith('rename-kanban.mjs')) {
  const dry = process.argv.includes('--dry')
  let changed = 0
  for (const path of walk(process.cwd())) {
    const before = readFileSync(path, 'utf8')
    const after = renameInProse(before)
    if (after === before) continue
    const hits = (before.match(/KanEO|Kaneo/g) ?? []).length - (after.match(/KanEO|Kaneo/g) ?? []).length
    console.log(`${dry ? 'would rename' : 'renamed'} ${hits} in ${path}`)
    if (!dry) writeFileSync(path, after, 'utf8')
    changed += 1
  }
  console.log(`${changed} file(s)`)
}
