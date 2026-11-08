#!/usr/bin/env node
/**
 * Merges the generic charter template into a target charter repository.
 *
 * Usage:
 *   node scripts/apply-charter-template.mjs --target <repo-dir> [--dry-run]
 *   node scripts/apply-charter-template.mjs --print-section
 *
 * Existing files are kept; only missing files are added. README is never overwritten: use --print-section to get the
 * capability-supply block and merge it into the existing README yourself.
 */
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyCharterTemplate, capabilitySection, TEMPLATE_ROOT } from './lib/charter-template.mjs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

if (flag('--print-section')) {
  console.log(capabilitySection())
  process.exit(0)
}

const targetArg = value('--target')
if (!targetArg) {
  console.error('Usage: node scripts/apply-charter-template.mjs --target <repo-dir> [--dry-run]')
  console.error('       node scripts/apply-charter-template.mjs --print-section')
  process.exit(1)
}
const target = resolve(targetArg)
const dryRun = flag('--dry-run')
if (!dryRun && !existsSync(target)) mkdirSync(target, { recursive: true })

const result = applyCharterTemplate(target, { dryRun })
console.log(`${dryRun ? '[dry-run] ' : ''}template: ${TEMPLATE_ROOT}`)
console.log(`target:   ${result.target}`)
console.log(`added:    ${result.added.length}`)
for (const path of result.added) console.log(`  + ${path}`)
console.log(`kept:     ${result.kept.length}`)
for (const path of result.kept) console.log(`  = ${path}`)
if (result.kept.includes('README.md')) {
  console.log('\nREADME.md 已存在，未覆盖。把「能力供给」一节合并进去：')
  console.log('  node scripts/apply-charter-template.mjs --print-section')
}
console.log('\n下一步：按 CHARTER-QUICKSTART.md 填 3 处、在面板发布宪章与职责、跑第一张卡。')
