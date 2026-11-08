/**
 * Builds INDEX.html: the reading map plus the verified minimal-iteration story appended to INDEX.md.
 * Five 16:9 pages: the map, the scenario setup, the iteration timeline, the evidence, and the retrospective.
 */
import { deck, shot } from './lib/deck-shell.mjs'

const i = deck({ title: 'INDEX · 阅读地图与实测故事', badge: 'SuperAgent · INDEX' })

// 1. The reading map: three paths and the eight root PDFs.
i.slide('index', 'dense active', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>INDEX · 8 份 PDF · 151 页</div>
      <h2>先看 <span class="accent">A-I 前三页</span>，再按目标选一条路</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>三条路</h3>
          <div class="list">
            <div class="li"><span class="mk dot">1</span><div><b>第一次跑通</b>：A-I → ABC → DEF → GHI（约 2 小时）</div></div>
            <div class="li"><span class="mk dot">2</span><div><b>搭宪章 / 能力体系</b>：EA → ABC → A-I（约 1.5 小时）</div></div>
            <div class="li"><span class="mk dot">3</span><div><b>理解设计 / 对外讲</b>：AIOS → STORY → A-I → EA（约 2 小时）</div></div>
            <div class="li"><span class="mk ok">4</span><div><b>日常手册</b>：SOP；细节回查 ABC / DEF / GHI</div></div>
          </div>
          <p class="small">按问题找：环境→ABC · 卡没接→DEF · 卡住→GHI · 复盘/知识→EA · 每天怎么干→SOP · 讲给别人→STORY。<br>第 2–5 页是 2026-11-08 真跑的一次最小迭代（PM 入册 → 派单 → Worker 交付 → 复盘）。</p>
        </div>
        <table class="tight">
          <tr><th>#</th><th>文件</th><th>用途</th><th>页</th></tr>
          <tr><td>①</td><td>A-I.pdf</td><td>九节完整流水线 + 真实演练（先看）</td><td>22</td></tr>
          <tr><td>②</td><td>ABC.pdf</td><td>把运行环境准备好（+ 建卡 4 条）</td><td>16</td></tr>
          <tr><td>③</td><td>DEF.pdf</td><td>需求怎么变成工单</td><td>16</td></tr>
          <tr><td>④</td><td>GHI.pdf</td><td>工单怎么执行、反馈与交付</td><td>21</td></tr>
          <tr><td>⑤</td><td>EA.pdf</td><td>宪章仓库 = 能力供给系统</td><td>20</td></tr>
          <tr><td>⑥</td><td>AIOS.pdf</td><td>为什么这样设计</td><td>18</td></tr>
          <tr><td>⑦</td><td>SOP.pdf</td><td>日常操作手册</td><td>22</td></tr>
          <tr><td>⑧</td><td>STORY.pdf</td><td>用户故事：小吴的一天</td><td>16</td></tr>
        </table>
      </div>
      <p class="small">PDF 由同名 <code>.md</code> / <code>.html</code> 生成；新增或删除 PDF 时同步 <code>INDEX.md</code> 与本页。</p>
    </div>`)

// 2. Scenario setup: the four sources and the two roles, with the real screenshots.
i.slide('scenario-setup', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>实测 · 场景设定（2026-11-08）</div>
      <h2>项目 id + 宪章仓库之后：<span class="accent">配 4 个源</span>，设 PM / Worker 两种角色</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>4 个源（设置 → 来源）</h3>
          <table class="tight">
            <tr><th>源</th><th>必填</th><th>本次</th></tr>
            <tr><td>Kanban</td><td>服务器 / API key / 项目</td><td>pl.feg.cn · 项目 id · 监听 to-do</td></tr>
            <tr><td>Gitea</td><td>服务器 / 仓库 / 宪章文件</td><td>git.feg.cn · shawoo/rsi_superagent · README.md</td></tr>
            <tr><td>ntfy</td><td>服务器 / 主题</td><td>msn.feg.cn · pub_&lt;项目 id&gt;</td></tr>
            <tr><td>MinIO</td><td>地址 / 桶 / 密钥</td><td>桶 ateam（密钥读本机存储记录）</td></tr>
          </table>
          <h3 style="margin-top:14px">Team 两种角色（设置 → 项目与岗位）</h3>
          <table class="tight">
            <tr><th>角色</th><th>岗位</th><th>关键字段</th></tr>
            <tr><td>PM</td><td>pm-rsi</td><td>WIP 2 · 5 条 pm-* 职责 · 监听 to-do</td></tr>
            <tr><td>Worker</td><td>ux-fdep / api-fdep</td><td>WIP 3 · ui+rehearsal / api</td></tr>
          </table>
          <p class="small">PM 初始化：宪章 v14 + 职责 10 条（新增 rehearsal→ux-fdep）+ PM 入册；4 源 4/4 ready，岗位身份 3/3 已映射。</p>
        </div>
        <div class="grid" style="gap:12px">
          ${shot('images/scenario/s1-sources.png', '四个源已接通', 190)}
          ${shot('images/scenario/s2-team-posts.png', 'PM 与两个 Worker 岗位', 190)}
        </div>
      </div>
    </div>`)

// 3. The iteration timeline, including the first refusal and the PM fix.
i.slide('timeline', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>实测 · 时间线（+08:00）</div>
      <h2>一次<span class="accent">被闸门拦下</span>、修复、再接单的迭代</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>时刻</th><th>动作</th><th>结果 / 证据</th></tr>
        <tr><td>16:45:11</td><td>PM 发布宪章 v14、职责 10 条</td><td>Worker 开工读到的版本即 v14</td></tr>
        <tr><td>16:47:31</td><td>建卡 #47（先放 in-review，不触发）</td><td>卡号 #47</td></tr>
        <tr><td>16:47:54–56</td><td>挂 duty:rehearsal + kind:doc，再移入 to-do</td><td>标签先挂、最后进监听列</td></tr>
        <tr><td>16:48:48</td><td><b>第一次决定：忽略（dutyUnsupported）</b></td><td>闸门真实拦截：ux-fdep 职责下拉只有 ui，没接 rehearsal</td></tr>
        <tr><td>16:49:31</td><td>主 Session 把拒绝原因写回卡/线程</td><td>“待 PM 把卡改派给承担该职责的岗位”</td></tr>
        <tr><td>~17:02</td><td>PM 修正岗位–职责映射并 requeue</td><td>人工 13 分钟，正是复盘要改进的点</td></tr>
        <tr><td>17:03:20</td><td>决定：<b>接单</b>（explicitRouted）</td><td>触发被重新受理</td></tr>
        <tr><td>17:03:25</td><td>派工给 ux-fdep，worker 会话开工</td><td>读宪章 v14 + duty brief</td></tr>
        <tr><td>17:05:36</td><td>写 MinIO deliverables/…/iteration.md</td><td>1928 字节，已回读</td></tr>
        <tr><td>17:06:13</td><td>报告 ready → 工单 completed</td><td>执行耗时 <b>2 分 53 秒</b></td></tr>
        <tr><td>17:06:23</td><td>卡片评论回写 bucket/key 与结论</td><td>卡进入 done</td></tr>
      </table>
      <p class="small">复盘结论：闸门拦住错误映射、没有乱建单；requeue 后一次通过。<b>唯一人工卡点是 PM 初始化漏了岗位–职责映射</b>，已列为第一条改进。</p>
    </div>`)

// 4. Evidence: the measured data and the three panel screenshots.
i.slide('evidence', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>实测 · 证据</div>
      <h2>2 分 53 秒交付、18 分 42 秒闭环；<span class="accent">一条真实闸门拦截</span></h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>指标</th><th>值</th></tr>
        <tr><td>决策</td><td>2 次忽略（dutyUnsupported / 说明）+ 1 次接单（explicitRouted）</td></tr>
        <tr><td>工单 / 卡片</td><td>0c83ceb9…，归属 ux-fdep，completed；卡 #47 done，2 条评论含 bucket/key</td></tr>
        <tr><td>耗时</td><td>执行 2 分 53 秒；端到端 18 分 42 秒（含人工修映射与 requeue）</td></tr>
        <tr><td>交付物</td><td>ateam/…/iteration.md，1928 B，minio_read 回读一致</td></tr>
        <tr><td>闸门</td><td>命中 1 次真实拦截（岗位未承接职责），修映射后放行</td></tr>
      </table>
      <div class="grid g3" style="gap:10px;margin-top:10px">
        ${shot('images/scenario/s3-trigger.png', '触发页里的场景线程', 150)}
        ${shot('images/scenario/s4-eval.png', '评估页：先拒后接', 150)}
        ${shot('images/scenario/s5-ticket-top.png', '工单页', 150)}
      </div>
    </div>`)

// 5. The manual retrospective and the automation path.
i.slide('retro', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>实测 · 复盘（这次手动）</div>
      <h2>方法、结论与改进项；<span class="accent">自动化路径已验证可接</span></h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>手动复盘：怎么做的</h3>
          <p><b>方法</b>：面板 API 取 threads / decisions / tickets 时间线 → MinIO 回读交付物 → Kaneo 取卡片状态与评论 → 按 EA 复盘门槛写结论（有数据、≤3 条改进、Owner+期限）。</p>
          <p><b>做得好</b>：闸门拦住错误映射、没有乱建单；requeue 后一次通过；worker 自读宪章 v14 并回读交付物。</p>
          <p><b>问题</b>：PM 初始化漏了“岗位–职责映射核对”，首次被闸门拒绝。</p>
          <p><b>结论</b>：一次完整闭环成立；唯一人工卡点是初始化映射，已作为第一条复盘改进。</p>
        </div>
        <div class="card"><span class="bar"></span><h3>改进（≤3，Owner / 期限）与自动化</h3>
          <p><b>①</b> PM 初始化清单加“岗位–职责映射核对” —— PM，本周</p>
          <p><b>②</b> 建卡前先对照 duty:&lt;id&gt; 与目标岗位职责自检 —— PM，立即</p>
          <p><b>③</b> 复盘定时化：cron → ntfy → 卡 → pm-retro-curator —— PM，P1</p>
          <p class="small">自动化未启用：Windows 任务计划/CI 定时向 ntfy（tag dsh）发日/周/月复盘；ntfy 来源入库成卡，若 PM 映射宿主账号则直接进 PM 队列。详见 PM.md §4。</p>
          <p class="small">复现：scripts/capture-scenario-shots.mjs；卡 #47、工单 0c83ceb9…、宪章 v14 均保留可查。</p>
        </div>
      </div>
    </div>`)

i.write('INDEX.html')
