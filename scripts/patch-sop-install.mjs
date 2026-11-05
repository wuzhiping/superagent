/**
 * Fixes the installation instructions: the bundle is installed with DSH's own plugin command, not with a guessed
 * `npx <package> install` line. Windows needs `npx.cmd` because PowerShell blocks the `.ps1` shim.
 *
 *   node scripts/patch-sop-install.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const files = {}
const load = path => (files[path] ??= readFileSync(path, 'utf8'))
const save = (path, text) => { files[path] = text }
const expect = (ok, label) => { if (!ok) { console.error(`MISS ${label}`); process.exitCode = 1 } }

// ---------------------------------------------------------------- SOP.md
{
  const path = 'SOP.md'
  let text = load(path)
  const from = [
    '### 2.1 安装',
    '',
    '```bash',
    'npx @deepseek-ai/dsh-superagent@latest install     # 一条命令装好插件',
    'dsh-superagent status                              # 看三个来源是否 ready',
    '```',
  ].join('\n')
  const to = [
    '### 2.1 安装',
    '',
    '用 DSH 自己的插件命令把本仓库装进目标 profile。**Windows 用 `npx.cmd`**（PowerShell 的执行策略会拦 `npx.ps1`）：',
    '',
    '```powershell',
    'npx.cmd @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"',
    '```',
    '',
    'macOS / Linux：',
    '',
    '```bash',
    'npx @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"',
    '```',
    '',
    '- `--profile web` 换成目标 profile 名；要固定版本就写 `#<tag 或 commit>`。',
    '- **更新**已有的安装：先 `... plugin --profile web remove dsh-superagent`，再执行上面的 add。',
    '- 装完重启 / 刷新 `dsh web` → 面板出现「超级智能体」→ **设置 → 来源**，三个来源 `ready` 即成功。',
    '- 仓库里已提交 `lib/`（构建产物），目标机器**不需要**编译；装完重启才生效。',
  ].join('\n')
  expect(text.includes(from), 'SOP.md install block')
  save(path, text.replace(from, to))
}

// ---------------------------------------------------------------- SOP.html
{
  const path = 'SOP.html'
  let text = load(path)
  expect(text.includes('<p><b>npx @deepseek-ai/dsh-superagent@latest install</b></p>'), 'SOP.html install line')
  text = text.replace(
    '<p><b>npx @deepseek-ai/dsh-superagent@latest install</b></p>\n          <p>然后 <b>dsh-superagent status</b>，三个来源都要 ready。</p>',
    '<p><code>npx.cmd @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"</code></p>\n'
    + '          <p>Windows 用 <b>npx.cmd</b>（PowerShell 会拦 .ps1）；macOS / Linux 用 <b>npx</b>。装完重启 / 刷新，面板出现「超级智能体」，三个来源 ready。</p>')
  text = text.replace(
    '<p>Kanban：地址 + API key + 项目 id + 监听列（slug）。</p>',
    '<p>Kanban：地址 + API key（可留空）+ 项目（从列表选）+ 监听列（slug）。</p>')
  save(path, text)
}

// ---------------------------------------------------------------- INSTALL.md
{
  const path = 'INSTALL.md'
  let text = load(path)
  const from = [
    '本仓库（`git+https://git.feg.cn/shawoo/superagent`）本身是一个 **DSH bundle**。其他设备可以用**一条 npx 命令**把它装进自己的 DeepSeek Harness：',
    '',
    '```powershell',
    '& "$bin\\npx.cmd" --prefix (Join-Path $PWD "node\\global") --cache (Join-Path $PWD "node\\cache") -y git+https://git.feg.cn/shawoo/superagent install',
    '```',
    '',
    '> `$bin` / `$PWD` 按你的便携目录替换；核心是 `npx -y git+https://git.feg.cn/shawoo/superagent install`。',
  ].join('\n')
  const to = [
    '本仓库（`git+https://git.feg.cn/shawoo/superagent`）本身是一个 **DSH bundle**，用 DSH 的插件命令装进目标 profile：',
    '',
    '```powershell',
    '# Windows：用 npx.cmd（PowerShell 的执行策略会拦 npx.ps1）',
    'npx.cmd @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"',
    '```',
    '',
    '```bash',
    '# macOS / Linux',
    'npx @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"',
    '```',
    '',
    '> 与 DSH「插件」页面安装 bundle 等价：把 `dsh-superagent` 写进 profile 的依赖与 `dsh.profile.bundles`。',
    '> `--profile` 换成目标 profile 名；需要固定版本用 `git+...#<tag 或 commit>`。',
    '> 仓库还带一个**便捷脚本**（会顺带写好 `stateDir`）：`npx -y git+https://git.feg.cn/shawoo/superagent install`，见 §2。',
  ].join('\n')
  expect(text.includes(from), 'INSTALL.md intro')
  text = text.replace(from, to)

  expect(text.includes('## 2. 安装命令的行为'), 'INSTALL.md section 2')
  text = text.replace('## 2. 安装命令的行为', '## 2. 便捷脚本的行为（`npx -y … install`）')
  expect(text.includes("`npx -y git+https://git.feg.cn/shawoo/superagent install` 会："), 'INSTALL.md behavior line')
  text = text.replace(
    '`npx -y git+https://git.feg.cn/shawoo/superagent install` 会：',
    '便捷脚本 `npx -y git+https://git.feg.cn/shawoo/superagent install` 会（不想用它时，直接用 §intro 的插件命令即可）：')

  expect(text.includes('## 4. 手动等价方式（不用 npx）'), 'INSTALL.md section 4')
  text = text.replace('## 4. 手动等价方式（不用 npx）', '## 4. 只用 dsh 命令（不经过便捷脚本）')

  expect(text.includes('- **Kanban**：服务器 + API key + 项目 id；'), 'INSTALL.md config step')
  text = text.replace(
    '- **Kanban**：服务器 + API key + 项目 id；',
    '- **Kanban**：服务器 + API key（可留空：本机存储记录里有）+ 项目（从列表选）；')

  save(path, text)
}

for (const [path, text] of Object.entries(files)) {
  writeFileSync(path, text, 'utf8')
  console.log(`updated ${path}`)
}
