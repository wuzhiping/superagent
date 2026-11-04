#!/usr/bin/env node
/**
 * dsh-superagent installer for DeepSeek Harness (superagent).
 *
 * Usage (typical):
 *   npx -y git+https://git.feg.cn/shawoo/superagent install
 *   npx -y git+https://git.feg.cn/shawoo/superagent install --profile web
 *
 * It adds this bundle to a DSH profile through the official `dsh plugin --profile <p> add <spec>`
 * path (the same mechanism the Plugin page uses), then records the state directory in that
 * profile's cordis.patch.yml.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_SPEC = 'git+https://git.feg.cn/shawoo/superagent'
const DEFAULT_PROFILE = 'web'
const PACKAGE_ID = 'dsh-superagent'
const MIN_NODE = [22, 19, 0]

const HELP = `dsh-superagent installer

用法 / Usage
  npx -y git+https://git.feg.cn/shawoo/superagent install [options]

选项 / Options
  --profile <name>   安装到哪个 DSH profile（默认 ${DEFAULT_PROFILE}）
  --spec <spec>      DSH 包 spec（默认 ${DEFAULT_SPEC}）
  --state-dir <path> 运行状态目录（默认 <DSH_HOME>/state/superagent）
  --dsh-home <path>  DSH_HOME（默认 $DSH_HOME，否则 ~/.dsh 或检测到的便携目录）
  --dsh <path>       dsh 可执行文件或 DSH 的 lib/bin.js（默认从 PATH / 便携目录探测）
  --dry-run          只打印将要执行的命令与写入位置，不做任何修改
  -h, --help         显示本帮助

前置条件：
  Node.js ^22.19.0 或 >=24；git；网络能访问 git.feg.cn；目标机器已安装并初始化过 DSH；
  DSH profile 的包管理使用 pnpm（pnpm 需在 PATH，或由 DSH 便携包提供）。`

function parseArgs(argv) {
  const options = { profile: DEFAULT_PROFILE, spec: DEFAULT_SPEC, stateDir: '', dshHome: '', dsh: '', dryRun: false }
  let command = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === 'install' && !command) command = 'install'
    else if (arg === '-h' || arg === '--help') command = 'help'
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg.startsWith('--profile=')) options.profile = arg.slice(10)
    else if (arg === '--spec') options.spec = argv[++i]
    else if (arg.startsWith('--spec=')) options.spec = arg.slice(7)
    else if (arg === '--state-dir') options.stateDir = argv[++i]
    else if (arg.startsWith('--state-dir=')) options.stateDir = arg.slice(12)
    else if (arg === '--dsh-home') options.dshHome = argv[++i]
    else if (arg.startsWith('--dsh-home=')) options.dshHome = arg.slice(11)
    else if (arg === '--dsh') options.dsh = argv[++i]
    else if (arg.startsWith('--dsh=')) options.dsh = arg.slice(6)
    else if (arg === '--yes' || arg === '-y') { /* npx already handles confirmation */ }
    else { console.error(`未知参数 / unknown argument: ${arg}\n`); command = 'help' }
  }
  return { command: command || 'install', options }
}

function nodeOk() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number)
  if (major >= 24) return true
  if (major !== 22) return false
  if (minor > MIN_NODE[1]) return true
  return minor === MIN_NODE[1] && patch >= MIN_NODE[2]
}

function resolveDshHome(options) {
  const cwd = process.cwd()
  const candidates = []
  if (options.dshHome) candidates.push(resolve(options.dshHome))
  if (process.env.DSH_HOME) candidates.push(resolve(process.env.DSH_HOME))
  // A portable installation keeps node/global beside profiles/ or beside the launcher.
  if (existsSync(join(cwd, 'node', 'global', 'node_modules', '@deepseek-ai', 'dsh'))) candidates.push(cwd)
  if (existsSync(join(cwd, 'profiles'))) candidates.push(cwd)
  candidates.push(join(homedir(), '.dsh'))
  return candidates.find(candidate => candidate && existsSync(candidate)) ?? candidates.at(-1)
}

function resolveDsh(options) {
  const cwd = process.cwd()
  const exe = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const candidates = []
  if (options.dsh) candidates.push(resolve(options.dsh))
  if (process.env.DSH_BIN) candidates.push(resolve(process.env.DSH_BIN))
  // Portable layout: <root>/node/global/node_modules/@deepseek-ai/dsh/lib/bin.js
  const portable = join(cwd, 'node', 'global', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(portable)) candidates.push(portable)
  const home = resolveDshHome(options)
  const portableHome = join(home, 'node', 'global', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(portableHome)) candidates.push(portableHome)
  // A command on PATH is used through the shell (portable layouts resolve to lib/bin.js above instead).
  const onPath = spawnSync(`${exe} --version`, { shell: true, encoding: 'utf8' })
  if (onPath.status === 0) candidates.push(exe)
  return candidates.find(candidate => candidate && (candidate === exe || existsSync(candidate))) ?? undefined
}

function runDshPlugin(dsh, profile, spec, dryRun) {
  const command = /\.js$/i.test(dsh)
    ? [process.execPath, dsh, 'plugin', '--profile', profile, 'add', spec]
    : [dsh, 'plugin', '--profile', profile, 'add', spec]
  console.log(`\n$ ${command.map(part => /[\s"]/.test(part) ? JSON.stringify(part) : part).join(' ')}`)
  if (dryRun) return { status: 0 }
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: command[0] === dsh && process.platform === 'win32' })
  return { status: result.status ?? 1, error: result.error }
}

/** Write the stateDir row into the profile patch once; DSH reads it as the plugin's config. */
function ensureStateDir(profileDir, stateDir, dryRun) {
  const patch = join(profileDir, 'cordis.patch.yml')
  const yamlValue = `'${stateDir.replace(/\\/g, '/').replace(/'/g, "''")}'`
  const row = `- id: ${PACKAGE_ID}\n  config:\n    stateDir: ${yamlValue}\n`
  const existing = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
  if (new RegExp(`^-\\s*id:\\s*${PACKAGE_ID}\\s*$`, 'm').test(existing)) {
    const section = existing.slice(existing.search(new RegExp(`^-\\s*id:\\s*${PACKAGE_ID}`, 'm')))
    if (/stateDir\s*:/.test(section)) { console.log(`stateDir 已在 ${patch} 中，跳过。`); return }
    console.log(`提示：${patch} 已有 ${PACKAGE_ID} 行但没有 stateDir，请手动加上 config.stateDir: ${yamlValue}`)
    return
  }
  console.log(`\n将把 stateDir 写入 ${patch}`)
  console.log(row.trimEnd())
  if (dryRun) return
  mkdirSync(dirname(patch), { recursive: true })
  // A freshly initialized profile patch is a single `[]` document (possibly with comments). It must be replaced,
  // not appended to, or the file becomes two YAML documents and DSH reads only the first one.
  const base = existing.replace(/^[ \t]*\[\][ \t]*\r?\n?/m, '')
  const separator = base ? (base.endsWith('\n') ? '' : '\n') : ''
  writeFileSync(patch, `${base}${separator}# ${PACKAGE_ID}: runtime state (SQLite, worker directories)\n${row}`, 'utf8')
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'help') { console.log(HELP); return 0 }
  if (!nodeOk()) {
    console.error(`Node.js 版本不满足要求：当前 ${process.versions.node}，需要 ^22.19.0 或 >=24.0.0。`)
    return 1
  }
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
  if (git.error || git.status !== 0) {
    console.error('未找到 git。通过 Git 地址安装需要先安装 git 并加入 PATH。')
    return 1
  }
  const dsh = resolveDsh(options)
  if (!dsh) {
    console.error('未找到 dsh。请用 --dsh <路径> 指定，或确认 DSH 已安装（便携布局：<root>/node/global/node_modules/@deepseek-ai/dsh/lib/bin.js）。')
    return 1
  }
  const dshHome = resolveDshHome(options)
  const profileDir = join(dshHome, 'profiles', options.profile)
  const stateDir = options.stateDir ? resolve(options.stateDir) : join(dshHome, 'state', 'superagent')
  console.log(`DSH 安装：${dsh}`)
  console.log(`DSH_HOME：${dshHome}`)
  console.log(`Profile：${options.profile}（${profileDir}）`)
  console.log(`包 spec：${options.spec}`)
  console.log(`stateDir：${stateDir}`)
  if (options.dryRun) console.log('\n[dry-run] 不执行安装、不修改文件。')

  const install = runDshPlugin(dsh, options.profile, options.spec, options.dryRun)
  if (install.status !== 0) {
    console.error('\n安装失败。常见原因：')
    console.error('- pnpm 不在 PATH（DSH 的插件安装使用 pnpm）；')
    console.error('- 目标机器无法访问 git.feg.cn（需要网络/代理，私有仓库还需要 git 凭据）；')
    console.error('- DSH 版本与包要求不匹配（package.json 的 engines.dsh / peerDependencies）；')
    console.error('- 若提示 build script 被拦截，说明包没有携带 lib；本仓库默认携带 lib，不需要构建。')
    return install.status ?? 1
  }
  ensureStateDir(profileDir, stateDir, options.dryRun)
  if (!options.dryRun) {
    console.log('\n完成。下一步：')
    console.log('1. 重启正在运行的 dsh web（或刷新已打开的 GUI）以加载 dsh-superagent；')
    console.log('2. 打开「超级智能体」面板 → 设置 → 来源，配置 Kaneo / Gitea / ntfy 并点「测试连接」；')
    console.log('3. 若 profile 当前是 web，重启后原有的 DSH 会话不受影响。')
  }
  return 0
}

process.exitCode = main()
