/**
 * Applies the generic charter template to a target charter repository.
 *
 * The template is additive: existing files are never overwritten, so it is safe to merge into a repository that
 * already has a README, duties, or any of the capability folders. A second run reports nothing to add (idempotent).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/** Template root, relative to the dsh-superagent working directory. */
export const TEMPLATE_ROOT = 'templates/charter'

/** Every file in the template, as POSIX-style relative paths. */
export function listTemplateFiles (root = TEMPLATE_ROOT) {
  const found = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else found.push(relative(root, path).split(sep).join('/'))
    }
  }
  if (!existsSync(root)) throw new Error(`Template root not found: ${root}`)
  walk(root)
  return found.sort()
}

/**
 * Copies every template file that is missing under `target`.
 * @returns {{ target: string, added: string[], kept: string[], dryRun: boolean }}
 */
export function applyCharterTemplate (target, { root = TEMPLATE_ROOT, dryRun = false } = {}) {
  const added = []
  const kept = []
  for (const relativePath of listTemplateFiles(root)) {
    const destination = join(target, relativePath)
    if (existsSync(destination)) { kept.push(relativePath); continue }
    if (!dryRun) {
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, readFileSync(join(root, relativePath)))
    }
    added.push(relativePath)
  }
  return { target, added, kept, dryRun }
}

/** The section to merge into an existing README (the template README is not copied over an existing one). */
export function capabilitySection () {
  return `## 能力供给（合并用）

规则之外，还要供给能力资产；先跑两条，其余按需启用：

| 层 | 目录 | 先用来做什么 |
| --- | --- | --- |
| 职责 | \`duties/\` | 每个岗位至少 1 条可派工的职责 |
| 复盘 | \`reviews/\` | 周复盘（日/月模板已在，可后启用） |
| 上下文 | \`context/\` | 最新复盘总结 + 1 个领域对象 |
| 知识 | \`KE/\` | 每周至少 1 条过 MAKE 的知识 |
| 技能 | \`skills/\` | 有真实使用的技能再发布（不要空建） |

- 检查清单与成长路线见产品仓库 \`CAPABILITY.md\` / \`EA.md\`。
- 铁律：没有 Owner 的资产不算落地；没人用的资产定期清理。`
}
