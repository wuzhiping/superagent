/**
 * Builds ABC.html from the SOP deck shell (same CSS, navigation, print rules and dense styles).
 *
 * ABC is a getting-ready guide: it covers only the Settings tabs, the minimum fields, what "OK" looks like and the
 * readiness checklist — no operating/task running. This deck mirrors ABC.md one slide per section.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const shell = readFileSync('SOP.html', 'utf8')
const startMarker = '<div class="viewport"><div class="stage" id="stage">'
const prefixEnd = shell.indexOf(startMarker) + startMarker.length
const prefix = shell.slice(0, prefixEnd).replace('<title>超级智能体 SOP · PM 岗位与岗位的入门指南</title>',
  '<title>ABC · 快速把运行环境准备好</title>')
const lastSection = shell.lastIndexOf('</section>')
const suffix = shell.slice(lastSection + '</section>'.length)
  .replace("b.textContent = 'SuperAgent · SOP'", "b.textContent = 'SuperAgent · ABC'")

const slides = []
const slide = (name, sectionClass, html) => slides.push(`\n  <!-- ${slides.length + 1} ${name} -->\n  <section class="slide${sectionClass ? ` ${sectionClass}` : ''}">\n${html}\n  </section>`)

slide('cover', 'cover active', `
    <div class="glow"></div><div class="ghost">ABC</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>QUICK START · 设置篇 · 只做准备与确认</div>
      <h1>快速把<span class="accent">运行环境准备好</span></h1>
      <p class="lead" style="max-width:46em">4 个设置 tab · 9 个动作 · 约 15 个必填字段 · 8 项就绪自检。<br>配好、看懂、有掌控感——不跑任务，不讲怎么干活。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag pm">PM · 15–20 分钟</span>
        <span class="tag worker">Worker · 3 分钟只读确认</span>
        <span class="tag kaneo">来源</span>
        <span class="tag gitea">项目与岗位</span>
        <span class="tag ntfy">评估 · 执行</span>
      </div>
      <div class="meta">
        <div>目标<b>运行环境就绪，且知道为什么就绪</b></div>
        <div>不做<b>不跑任务、不派工、不讲日常操作</b></div>
        <div>配套文档<b>ABC.md · SOP.md · AIOS.md</b></div>
      </div>
    </div>`)

slide('goal', 'airy', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>GOAL</div>
      <h2>这次只做三件事</h2>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card k"><span class="bar"></span><div class="num">01</div><h3>配好</h3><p>把四个"家"接上、登记项目与岗位、发布宪章与职责说明。</p><p class="small">动作：4 个 tab、9 步。</p></div>
        <div class="card w"><span class="bar"></span><div class="num">02</div><h3>看懂</h3><p>每一步都有"看到什么算 OK"：ready、已映射、v1、自动接单。</p><p class="small">结果可验证，不靠感觉。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">03</div><h3>有掌控感</h3><p>一份状态字典：每个状态说明含义与下一步动作。</p><p class="small">出问题知道回哪个 tab 改。</p></div>
      </div>
    </div>`)

slide('map', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>THE MAP · 只动 4 个 tab</div>
      <h2>设置页的六个 tab，你只用前四个</h2>
    </div>
    <div class="content">
      <div class="flow">
        <div class="step"><b>① 来源</b><span>四个家：4 张卡</span></div><div class="arrow">→</div>
        <div class="step"><b>② 项目与岗位</b><span>项目 · 2 个岗位 · 宪章 · 职责说明</span></div><div class="arrow">→</div>
        <div class="step"><b>③ 评估</b><span>自动接单 · 模型</span></div><div class="arrow">→</div>
        <div class="step"><b>④ 执行</b><span>执行模型 · 并行数</span></div>
      </div>
      <div class="grid g2">
        <div class="card"><span class="bar"></span><h3>保持默认的 tab</h3><p><b>提示词</b>、<b>部署</b>：第一次配置不用动，只在自检里确认能打开。</p></div>
        <div class="card"><span class="bar"></span><h3>入口</h3><p>DSH → 左侧 <b>超级智能体</b> → <b>Team 视角</b> → <b>设置</b>。按钮文字随界面语言（简/繁）变化，按同名找。</p></div>
      </div>
      <p class="small">九个动作：来源 ×4、项目+岗位 ×1、宪章 ×1、职责说明 ×1、评估 ×1、执行 ×1。</p>
    </div>`)

slide('minimum', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>MINIMUM · 必填很少</div>
      <h2>只有 ★ 字段要填，其余全默认</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>Tab</th><th>★ 必填</th><th>其余（保持默认）</th></tr>
        <tr><td>来源 · Kanban</td><td>服务器、API key、项目（下拉选）、监听列 ready</td><td>认领列/交付列/首次轮询/标签过滤</td></tr>
        <tr><td>来源 · Gitea</td><td>服务器、账号/密码、宪章仓库 owner/name</td><td>宪章文件默认 README.md</td></tr>
        <tr><td>来源 · ntfy</td><td>服务器、topic</td><td>入库 tag 建议 dsh；认证按服务端</td></tr>
        <tr><td>来源 · MinIO</td><td>服务地址、桶</td><td>密钥可留空（用本机存储记录）</td></tr>
        <tr><td>项目与岗位</td><td>项目、每个岗位的 id / 角色 / 登录邮箱</td><td>监听列 ready、WIP 默认、Gitea/ntfy 身份</td></tr>
        <tr><td>宪章</td><td>正文（5 行模板）</td><td>发布者、历史自动记录</td></tr>
        <tr><td>职责说明</td><td>正文（1 段模板；发布后拆成 duties/ 下一个职责一个文件）</td><td>其余职责字段按模板</td></tr>
        <tr><td>评估 / 执行</td><td>接单模式=自动接单；模型可用</td><td>时限、并行数、执行目录</td></tr>
      </table>
    </div>`)

slide('sources', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 1 · 来源</div>
      <h2>四张卡 = 四个家：任务 / 规则 / 文件 / 通知</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>卡片</th><th>填什么（★）</th><th>保存后看到</th></tr>
        <tr><td>Kanban 看板</td><td>服务器、API key、项目、监听列</td><td>测试连接通过；项目可选</td></tr>
        <tr><td>Gitea（宪章仓库）</td><td>服务器、账号、宪章仓库、README.md</td><td>连接通过，可读写宪章</td></tr>
        <tr><td>ntfy 主题</td><td>服务器、topic、入库 tag</td><td>topic 可订阅</td></tr>
        <tr><td>MinIO 对象存储</td><td>服务地址、桶、密钥（可留空）</td><td>桶可读</td></tr>
      </table>
      <div class="grid g2">
        <div class="card g"><span class="bar"></span><h3>OK 的样子</h3><p>四张卡无红色报错；编队页来源状态正常。</p></div>
        <div class="card n"><span class="bar"></span><h3>小提示</h3><p>保存来源后可能提示"正在重启/重连"几秒，正常，等恢复即可。</p></div>
      </div>
    </div>`)

slide('project-posts', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 2 · 项目与岗位</div>
      <h2>选项目、加两个岗位（只填 ★ 三项）</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>项目</h3><p>下拉里<b>选</b>项目，名称与 slug 自动带出；主题集可留空。</p><p class="small">别手抄项目 id。</p></div>
        <div class="card"><span class="bar"></span><h3>两个岗位</h3><p>新增项目时<b>默认已带一个 PM 岗位和一个 Worker 岗位</b>；用不上的可删除。</p><p>只补三项：id <code>pm-/w1-&lt;项目&gt;</code>、登录邮箱；角色已选好。</p><p class="small">监听列 ready、WIP 默认；页面底部保存档案。</p></div>
      </div>
      <p class="small">OK 的样子：每张岗位卡下方出现「已映射到 Kanban 使用者 id：…」。</p>
    </div>`)

slide('charter', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 2 · 宪章</div>
      <h2>发布团队公约：复制 5 行就能用</h2>
    </div>
    <div class="content">
      <pre>目标：&lt;这一期为客户创造什么&gt;
流程：ready → in-progress → in-review → done
岗位：PM 派工、审进度、处理异常；Worker 执行与交付
交付：文档/方案放 MinIO；代码开 PR；卡片回写结果
异常：卡住 → 评论提问并转 blocked，进 PM 异常队列</pre>
      <div class="grid g2">
        <div class="card"><span class="bar"></span><h3>动作</h3><p>写正文 → 点<b>发布宪章</b>。</p></div>
        <div class="card g"><span class="bar"></span><h3>OK 的样子</h3><p>版本号 <b>≥ v1</b>，有发布时间与发布者；每周最多发布一版。</p></div>
      </div>
    </div>`)

slide('duties', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 2 · 职责说明</div>
      <h2>发布任务说明书：1 段模板起步</h2>
    </div>
    <div class="content">
      <pre>### doc · 文档交付
- 承接岗位：（可留空，发布后在岗位卡下拉里选）
- 目标：按卡片要求产出一份文档
- 完成：文件已上传并可回读，卡片回写文件位置
- 载体：MinIO 对象（deliverables/&lt;项目&gt;/&lt;工单&gt;/&lt;文件&gt;）
- 步骤：读宪章 → 读卡片 → 写文档 → 上传回读 → 报告</pre>
      <div class="grid g2">
        <div class="card"><span class="bar"></span><h3>动作</h3><p>编辑 → 点<b>发布职责说明</b>（按标题拆成 duties/ 下一职责一文件）。</p></div>
        <div class="card g"><span class="bar"></span><h3>OK 的样子</h3><p>职责列表出现、条数正确；发布后回岗位卡用「接哪些职责」下拉选中它。</p></div>
      </div>
    </div>`)

slide('card-rules', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>建卡 4 条 · 派卡的人看</div>
      <h2>标签先挂，最后才拖进监听列</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>顺序</h3>
          <div class="list">
            <div class="li"><span class="mk dot">1</span><div><b>先挂标签</b>：<code>duty:</code> / <code>kind:</code> / <code>repo:</code></div></div>
            <div class="li"><span class="mk dot">2</span><div><b>负责人</b> = 岗位的 Kanban 账号</div></div>
            <div class="li"><span class="mk dot">3</span><div><b>描述</b>写清验收口径与交付到哪</div></div>
            <div class="li"><span class="mk ok">4</span><div><b>最后</b>才拖进监听列（<code>to-do</code>）</div></div>
          </div>
        </div>
        <div class="card g"><span class="bar"></span><h3>为什么</h3><p>标签在<b>触发那一刻</b>读取。后挂标签的工单会缺少产出类型/职责（实测 #45）。</p><p class="small">对照实验 #46：标签先挂 → 工单直接带「产出类型：文档」。</p><p class="small">演练见 A-I.md §11。</p></div>
      </div>
    </div>`)

slide('evaluation', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 3 · 评估</div>
      <h2>让系统自己接单：只动两个地方</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>设置</th><th>怎么选</th><th>含义</th></tr>
        <tr><td>接单模式</td><td><b>自动接单</b></td><td>系统会自己评估并接单；"仅观察"只记录不接</td></tr>
        <tr><td>研判模型</td><td>默认可就不动；不可用则选一个</td><td>系统判断"这单接不接"用的模型</td></tr>
      </table>
      <div class="grid g2">
        <div class="card"><span class="bar"></span><h3>还要看一眼</h3><p>「在各来源上」的发起人名单里有团队账号（Kanban/Gitea/ntfy）。</p></div>
        <div class="card g"><span class="bar"></span><h3>OK 的样子</h3><p>保存成功；接单模式显示<b>自动接单</b>；模型可用。</p></div>
      </div>
    </div>`)

slide('execution', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>TAB 4 · 执行</div>
      <h2>确认谁来干、并行多少</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>设置</th><th>建议</th><th>说明</th></tr>
        <tr><td>执行器模型</td><td>可用即可；不可用则选一个</td><td>真正干活用的模型</td></tr>
        <tr><td>并行工单数</td><td>1–2</td><td>同时最多干几个活</td></tr>
        <tr><td>执行目录 / 环境</td><td>留空用默认</td><td>无需手改</td></tr>
      </table>
      <div class="card g"><span class="bar"></span><h3>OK 的样子</h3><p>保存成功；「编队」页/岗位视角显示执行器运行中、无红色报错。</p></div>
    </div>`)

slide('checklist', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>READINESS · 设置检查</div>
      <h2>面板顶部就有 8 项是否就绪</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>8 项自动检查</h3>
          <div class="check">
            <div><i>✓</i>四个家已连接</div>
            <div><i>✓</i>项目已登记</div>
            <div><i>✓</i>岗位身份已映射</div>
            <div><i>✓</i>宪章已发布</div>
            <div><i>✓</i>职责说明已发布</div>
            <div><i>✓</i>接单模式已确认</div>
            <div><i>✓</i>执行器已确认</div>
            <div><i>✓</i>部署正常</div>
          </div>
        </div>
        <div class="card"><span class="bar"></span><h3>怎么看</h3>
          <div class="list">
            <div class="li"><span class="mk ok">●</span><div><b>绿</b> = 已就绪；<b>黄</b> = 还要处理；<b>红</b> = 有错误</div></div>
            <div class="li"><span class="mk dot">•</span><div>点任意一项 → 直达对应设置 tab</div></div>
            <div class="li"><span class="mk dot">•</span><div>右上「刷新检查」立即重查；卡片显示 <b>x/8 已就绪</b></div></div>
            <div class="li"><span class="mk ok">✓</span><div>8 项全绿 = 运行环境就绪，不用再翻页核对</div></div>
          </div>
        </div>
      </div>
    </div>`)

  slide('state-dictionary', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>CONTROL · 看到什么就是什么</div>
      <h2>状态字典：随时知道"现在怎样、要不要动手"</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>你看到的</th><th>含义</th><th>你要做什么</th></tr>
        <tr><td>来源 正常 / ready</td><td>这条路通了</td><td>不用管</td></tr>
        <tr><td>来源 暂停 / paused</td><td>被关掉或还没配</td><td>想用就打开并保存</td></tr>
        <tr><td>来源 错误 / error</td><td>地址、凭据或权限不对</td><td>按提示改，再测一次</td></tr>
        <tr><td>已映射到 Kanban 使用者 id：…</td><td>系统知道卡派给谁</td><td>不用管</td></tr>
        <tr><td>宪章 v1 / v2…</td><td>团队公约已生效</td><td>每周复盘后最多改一版</td></tr>
        <tr><td>职责说明 1 条 / N 条</td><td>系统认得这几类活</td><td>新增活法时再来加</td></tr>
        <tr><td>接单模式 自动接单</td><td>会自己接单开工</td><td>不用管；观察演练可改"仅观察"</td></tr>
        <tr><td>执行器 0 / 1，排队 0</td><td>当前没有在跑的活</td><td>不用管；有活时会动</td></tr>
      </table>
    </div>`)

slide('worker', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>WORKER · 3 分钟只读确认</div>
      <h2>不改设置，只确认三处</h2>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card w"><span class="bar"></span><div class="num">01</div><h3>设置 → 我的岗位设置</h3><p>先选「我是哪个岗位」，再核对岗位 id、角色 Worker、监听列、WIP。</p></div>
        <div class="card"><span class="bar"></span><div class="num">02</div><h3>来源</h3><p>四张卡是只读的，没有红色报错。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">03</div><h3>无异常提示</h3><p>面板没有"未设置岗位"之类提示；不对就找 PM 回对应 tab 修。</p></div>
      </div>
    </div>`)

slide('problems', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>SETUP TROUBLES · 按 tab 定位</div>
      <h2>设置阶段最常见的问题</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>现象</th><th>多半在</th><th>怎么办</th></tr>
        <tr><td>来源连不上</td><td>来源</td><td>检查地址/凭据；密钥可留空用本机存储记录</td></tr>
        <tr><td>项目下拉是空的</td><td>来源 · 看板</td><td>API key 无该工作区权限，或地址错</td></tr>
        <tr><td>邮箱不在工作区成员里</td><td>项目与岗位 · 岗位</td><td>让同事先加入 Kanban 工作区</td></tr>
        <tr><td>发布宪章失败</td><td>项目与岗位 · 宪章</td><td>Gitea 仓库无写权限，或仓库/文件名填错</td></tr>
        <tr><td>模型显示"默认不可用"</td><td>评估 / 执行</td><td>选一个可用的服务商与模型</td></tr>
        <tr><td>保存时提示冲突</td><td>项目与岗位</td><td>重新载入后再保存</td></tr>
      </table>
    </div>`)

slide('closing', 'cover', `
    <div class="glow" style="left:-10%;right:auto"></div><div class="ghost">OK</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>DONE · 环境就绪</div>
      <h1>4 个 tab、9 个动作、<br><span class="accent">8 项自检</span></h1>
      <p class="lead" style="max-width:44em">全打勾 = 运行环境准备好，而且你知道每个状态的含义。<br>接下来派一张卡、看它被接走——那是工作方式，交给 SOP / STORY。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag">ABC.md · 完整说明</span>
        <span class="tag">SOP.md · 日常操作</span>
        <span class="tag">STORY.md · 一个完整故事</span>
        <span class="tag">AIOS.md · 为什么这样设计</span>
      </div>
    </div>`)

writeFileSync('ABC.html', prefix + slides.join('\n') + '\n\n' + suffix.trimStart(), 'utf8')
console.log(`ABC.html written: ${slides.length} slides`)
