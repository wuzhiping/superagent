/**
 * Brings SOP.html up to date with the milestone the repository just tagged: Kanban naming, a project-level charter
 * with a weekly ceiling, deliverables in MinIO with the result on the card, the cleanup page, storage credentials,
 * project pickers and the topic default.
 *
 *   node scripts/patch-sop-milestone.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'SOP.html'
let text = readFileSync(path, 'utf8')
let changed = 0
const replace = (from, to, label) => {
  if (!text.includes(from)) { console.error(`MISS ${label}`); process.exitCode = 1; return }
  text = text.replace(from, to)
  changed += 1
}

// 名词表: the charter is a project document with a weekly ceiling, not a weekly minimum.
replace(
  '<tr><td>宪章 charter</td><td>PM 颁布的项目流程版本，不低于周频率</td><td>编队页「宪章 vN」徽标</td></tr>',
  '<tr><td>宪章 charter</td><td><b>整个项目一份</b>、各岗位（含其它 Host）共同遵守的流程与价值流约定；<b>每周至多一版</b></td><td>编队页「宪章 vN」徽标</td></tr>',
  'glossary charter')

// 上手三步: the key may come from the storage record; the project is picked; the charter is published onto the project.
replace(
  '<p>设置 → 来源 → Kanban：服务器地址 + <b>API key</b> → 保存。</p>',
  '<p>设置 → 来源 → Kanban：服务器地址 + <b>API key</b>（可留空：本机存储记录里就有）→ 保存。</p>',
  'onboarding key')
replace(
  '<p>项目 id + 每个岗位的 <b>Kanban 用户 id</b> + 领哪些列 + 并发上限。</p>',
  '<p><b>从列表选项目</b>（id / 名称 / slug 自动填，主题集默认 <code>pub_&lt;项目 id&gt;</code>）+ 每个岗位的 <b>Kanban 用户 id</b> + 领哪些列 + 并发上限。</p>',
  'onboarding project')
replace(
  '<p>版本号 +1、记发布者、旧版进历史；工单钉在开工那版。</p>',
  '<p>发布写到<b>项目上</b>（一份、全项目共享）；版本号 +1、记发布者、旧版进历史；<b>每周至多一版</b>；工单钉在开工那版。</p>',
  'onboarding charter')

// 登记三件事 table.
replace(
  '<tr><td>项目 id / 名称 / slug</td><td>Kanban 项目标识与看板 slug</td><td>dgctny8ibgpn72ei2j8qj2hc · FDEP · FDE</td></tr>',
  '<tr><td>项目</td><td><b>从列表选</b>（这台 Host 的账号能看到的项目）；选中后 id / 名称 / slug 自动填</td><td>FDEP（FDE）· ATEAM</td></tr>',
  'register project')
replace(
  '<tr><td><b>宪章</b></td><td>当期怎么做事：流程、职责、交付标准；写完点「发布」</td><td>version: 2 · publishedBy: pm-fdep</td></tr>',
  '<tr><td><b>宪章</b></td><td>当期怎么做事：流程、职责、交付标准；写完点「发布」——写到<b>项目上</b>，一个项目只有一份，<b>每周至多一版</b></td><td>version: 2 · publishedBy: pm-fdep</td></tr>',
  'register charter')
replace(
  '<tr><td>主题集</td><td>该项目订阅的 ntfy topic</td><td>pub_fdep_pm</td></tr>',
  '<tr><td>主题集</td><td>该项目订阅的 ntfy topic；<b>留空默认所选项目的 <code>pub_&lt;项目 id&gt;</code></b></td><td>pub_fdep_pm</td></tr>',
  'register topics')

// 宪章 slide: the flow grows in Kanban first, then the charter confirms it; publishing is what remembers it.
replace(
  '<p>确认后写进宪章新版本，并在面板 <b>设置 → 项目与岗位 → 流程</b> 同步列语义。</p>',
  '<p>确认后先在 Kanban 里加/改列，再在面板 <b>设置 → 项目与岗位 → 宪章</b> 写新版并点「发布」：发布写到<b>项目上</b>，其它 Host 读到同一份。</p>',
  'charter flow')
replace(
  '<p class="small">面板编队页会把<b>看板的列</b>与<b>宪章声明的列</b>并排显示：出现黄色「看板多出的列」＝ 流程长出来了，还没被确认。超过 7 天未更新 → 徽标变黄，提示 PM 补发。</p>',
  '<p class="small">面板编队页会把<b>看板的列</b>与<b>宪章声明的列</b>并排显示：出现黄色「看板多出的列」＝ 流程长出来了，还没被确认。<b>每周至多一版</b>：7 天内再发会被拒并告知下次可发布时间；确需提前改，点「仍然发布（覆盖每周一次的限制）」。</p>',
  'charter drift')

// 执行与交付: the fixed object-store recipe and the host writing the board.
replace(
  '<p>MinIO 只有<b>执行会话</b>能写：文档由执行环节上传，岗位取回链接回写看板。</p>',
  '<p>文档/方案<b>存 MinIO，不贴进评论</b>：<code>minio_write</code> 到 <code>deliverables/&lt;项目 id&gt;/&lt;ticket id&gt;/&lt;file&gt;</code> → <code>minio_read</code> 回读确认 → 报告写 <code>bucket/key</code>；卡片只留进度与结果。</p>'
  + '<p><b>看板由宿主写</b>：岗位报告 ready，宿主把结果写成评论并把卡片推进交付列；岗位不要自己调用看板 API 搬卡。</p>',
  'deliver minio')

// 限制表: no longer "host cannot reach MinIO"; the weekly ceiling and the board's own automation are the real limits.
replace(
  '<tr><td>MinIO 边界</td><td>岗位（host）访问不了 MinIO</td><td>执行会话上传，岗位取链接回写</td></tr>',
  '<tr><td>MinIO 边界</td><td>岗位（host）不直接写桶</td><td>执行会话用 <code>minio_*</code> 工具上传，key 固定为 <code>deliverables/&lt;项目 id&gt;/&lt;ticket id&gt;/&lt;file&gt;</code></td></tr>',
  'limits minio')
replace(
  '<tr><td>宪章过期</td><td>超过 7 天未发布</td><td>PM 周更；岗位接单时记一条提醒</td></tr>',
  '<tr><td>宪章过期 / 每周上限</td><td>超过 7 天没更新；或 7 天内想再发一版</td><td>周复盘后发；确需提前改，点「仍然发布（覆盖每周一次的限制）」并在正文说明理由</td></tr>'
  + '\n        <tr><td>看板自动化抢跑</td><td>进入 ready 约 20 秒就被搬到 in-progress，60 秒轮询会漏</td><td>轮询间隔 ≤ 15 秒，或把 in-progress 也纳入监听列</td></tr>',
  'limits charter')

// PM 日循环: closing the day includes the cleanup page.
replace(
  '<h3>收工检查</h3><p>每张卡都回写了状态与日志才算交付；没回写的不要急着关。</p>',
  '<h3>收工检查</h3><p>每张卡都回写了状态与日志才算交付；没回写的不要急着关。收工后到 <b>清理</b> 页把已结束职责的工作区集中清掉（有交付物的行要人确认）。</p>',
  'daily closing')

// 上线检查清单.
replace(
  '<div><i>✓</i>项目与岗位已登记（id / 宪章载体 / 监听列 / 仓库 / topic）</div>',
  '<div><i>✓</i>项目从<b>列表</b>选好（主题集默认 <code>pub_&lt;项目 id&gt;</code>），岗位已登记（监听列 / Kanban 用户 id）</div>',
  'checklist project')
replace(
  '<div><i>✓</i>宪章 v1 已发布（描述里有 version: 1）</div>',
  '<div><i>✓</i>宪章 v1 已<b>发布到项目上</b>（项目的 description 里有 version: 1）</div>',
  'checklist charter')

// A slide of its own for the cleanup page, inserted before the limits slide.
const limits = '  <!-- 13 limits -->'
if (!text.includes(limits)) { console.error('MISS limits anchor'); process.exitCode = 1 } else {
  const cleanup = `  <!-- 12b cleanup -->
  <section class="slide airy">
    <div class="head">
      <div class="kicker"><span class="dot"></span>CLEANUP</div>
      <h2>收工之后：集中清理工作区</h2>
      <p class="lead" style="font-size:18px">每个职责都会留下一个工作区和一条 Session；清理是 PM 的收尾动作。</p>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card k"><span class="bar"></span>
          <div class="num">WHERE</div><h3>「清理」页（PM 视角）</h3>
          <p>只列<b>已结束</b>职责留下的工作区：按大小排序，标出 Session 数、顶层文件、<b>是否有交付物</b>。</p>
          <p>未结束的职责、被别的职责引用的目录，一律跳过。</p>
        </div>
        <div class="card g"><span class="bar"></span>
          <div class="num">HOW</div><h3>先看，再勾，再确认</h3>
          <p>默认只勾「已结束 + 可清 + 无交付物」；<b>有交付物的行必须人点</b>。</p>
          <p>要连目录一起删，单独勾「同时删除工作区文件夹」并在弹窗里确认——不可恢复。</p>
        </div>
        <div class="card n"><span class="bar"></span>
          <div class="num">WHAT STAYS</div><h3>Session 只解除登记</h3>
          <p>没有受支持的 Session 删除 API：清理只<b>解除工作区登记</b>，日志保留可回放。</p>
          <p>stateDir、执行根、盘根与指向执行根之外的符号链接都会被拒绝。</p>
        </div>
      </div>
      <p class="small">这就是「工作区列表膨胀」的解药：跑得越久，已结束的职责越多，定期清一次比到处找目录省事。</p>
    </div>
  </section>

`
  text = text.replace(limits, cleanup + limits)
  changed += 1
}

writeFileSync(path, text, 'utf8')
console.log(`${changed} edit(s) applied to SOP.html`)
