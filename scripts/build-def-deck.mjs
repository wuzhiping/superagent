/**
 * Builds DEF.html: 一个需求怎么变成工单（触发 → 评估 → 工单）in the SOP deck shell.
 * Mirrors DEF.md one slide per section, with real panel screenshots.
 */
import { deck, shot, cover } from './lib/deck-shell.mjs'

const d = deck({ title: 'DEF · 一个需求怎么变成工单', badge: 'SuperAgent · DEF' })

d.slide('cover', 'cover active', cover({
  kicker: 'DEF · 需求的一生 · 触发 → 评估 → 工单',
  ghost: 'DEF',
  title: '一个需求，<span class="accent">怎么变成工单</span>',
  lead: '跟着一张看板卡或一条聊天消息走完它的一生：被看见、被判断、过闸门、变成可执行的工作单。<br>不配环境、不讲交付——只讲这一步。',
  tags: ['DEF.md · 配图走一遍', 'ABC.md · 先备环境', 'GHI.md · 接下来执行'],
  meta: [['目标', '看懂需求怎么变工单'], ['给谁看', 'PM 5–10 分钟'], ['前提', '设置检查全绿']],
}))

d.slide('overview', 'airy', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>30 秒全貌</div>
      <h2>需求 → 触发 → 判断 → 闸门 → 工单</h2>
    </div>
    <div class="content">
      <div class="flow">
        <div class="step"><b>① 需求</b><span>看板卡 / 聊天消息</span></div><div class="arrow">→</div>
        <div class="step"><b>② 触发</b><span>系统"看见"了它</span></div><div class="arrow">→</div>
        <div class="step"><b>③ 判断</b><span>接 / 不接</span></div><div class="arrow">→</div>
        <div class="step"><b>④ 闸门</b><span>宪章 / 职责 / 岗位</span></div><div class="arrow">→</div>
        <div class="step"><b>⑤ 工单</b><span>可执行、有授权</span></div>
      </div>
      <div class="grid g2">
        <div class="card g"><span class="bar"></span><h3>看板卡 = 显式请求</h3><p>人把卡放进监听列并指派岗位，就是明确请求 → <b>直接路由</b>，不经模型研判。</p></div>
        <div class="card"><span class="bar"></span><h3>推断候选才研判</h3><p>聊天里<b>没点名</b>、但发送人在名单里 → 进评估：按规则判断接不接。</p></div>
      </div>
      <p class="small">闸门不过就没有工单：决定里写明理由，卡片不动。</p>
    </div>`)

d.slide('vocabulary', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>术语 · 面板里就用这些词</div>
      <h2>先把八个词对齐</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>词</th><th>在这里的意思</th></tr>
        <tr><td>触发 Trigger</td><td>系统"看见"的一条需求：卡进入监听列，或聊天里来了一条消息</td></tr>
        <tr><td>线程 Thread</td><td>需求的上下文：一张卡 = 一个线程；一段对话 = 一个线程</td></tr>
        <tr><td>评估 Eval</td><td>判断这条需求该不该接；只有"推断的候选"才需要模型研判</td></tr>
        <tr><td>决定 Decision</td><td>评估的结论：接单 / 忽略 / 未完成，每条都有理由</td></tr>
        <tr><td>工单 Ticket</td><td>变成可执行的工作：有标题、范围、授权依据和归属岗位</td></tr>
        <tr><td>授权 Mandate</td><td>凭什么干：谁发起、以什么方式（明确/推断）、按哪版策略</td></tr>
        <tr><td>职责 Duty</td><td>这类活怎么干：卡片用 <code>duty:&lt;id&gt;</code> 声明，规格在宪章仓库</td></tr>
        <tr><td>岗位 Post</td><td>谁来干：本机 Team 里登记的岗位；工单有"归属岗位"</td></tr>
      </table>
    </div>`)

d.slide('settings', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>依赖 · ABC 已经备好</div>
      <h2>这一步用到的设置，各自管什么</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>设置</th><th>在"需求 → 工单"里管什么</th></tr>
        <tr><td>来源 → 看板</td><td>监听哪些列（<code>to-do</code>）、发起人名单、接收范围</td></tr>
        <tr><td>来源 → 看板（标签）</td><td>只收带指定标签的卡（默认不限）</td></tr>
        <tr><td>评估 → 规则</td><td>"这条消息像不像一件该干的活"的规则（copy / visual…）</td></tr>
        <tr><td>评估 → 接单模式</td><td><b>只影响推断的候选</b>；看板卡不受影响</td></tr>
        <tr><td>评估 → 时限 / 模型</td><td>一次研判最多 120 秒、用哪个模型</td></tr>
        <tr><td>宪章 / 职责 / 岗位</td><td>三道闸门的依据：有规矩、怎么干、谁承接、PM 能不能干</td></tr>
        <tr><td>执行 → 并行数 / 模型</td><td>工单建好后同时能跑几个、谁来跑（下一份 GHI）</td></tr>
      </table>
    </div>`)

d.slide('paths', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>判断 · 两条路</div>
      <h2>需求从哪来，决定它走哪条路</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>需求从哪来</th><th>系统的处理</th><th>会产生"评估"吗</th></tr>
        <tr><td>看板卡（含 ntfy 入库卡）</td><td><b>显式请求</b> → 主 Session 直接<b>接单路由</b></td><td>不研判，但记一条决定：接单</td></tr>
        <tr><td>聊天消息 · 名单内的人点名</td><td><b>显式请求</b> → 直接路由</td><td>不研判</td></tr>
        <tr><td>聊天消息 · 名单内、没点名</td><td><b>推断的候选</b> → 进评估</td><td>会研判：接单 / 忽略 / 未完成</td></tr>
        <tr><td>聊天消息 · 发送人不在名单</td><td>在策略层就被过滤</td><td>不评估；来源页显示原因</td></tr>
      </table>
      <p class="small">本机现状：来源只有看板 / Gitea / ntfy / MinIO，ntfy 消息先入库成卡 → 需求都是看板卡 = 路由；模型研判要接聊天来源（如飞书）后才会出现。</p>
    </div>`)

d.slide('d1', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D1 · 需求上板</div>
      <h2>先有一张像样的卡</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>卡上的东西</th><th>示例</th><th>为什么重要</th></tr>
        <tr><td>标题</td><td>登录页按钮颜色改成品牌色</td><td>会变成工单标题</td></tr>
        <tr><td>描述</td><td>现状截图 + 期望 + 验收口径</td><td>评估/派工的依据</td></tr>
        <tr><td>负责人</td><td>前端岗位的 Kanban 账号</td><td>决定"发起人"</td></tr>
        <tr><td>标签</td><td><code>duty:ui</code></td><td>声明职责，闸门要用</td></tr>
        <tr><td>所在列</td><td><code>to-do</code>（监听列）</td><td>不在这列，系统看不见</td></tr>
      </table>
      <p class="small">看什么算 OK：卡有负责人、有 <code>duty:</code> 标签、落在监听列。标签要在进监听列之前挂好（触发时读取）。</p>
    </div>`)

d.slide('d2', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D2 · 触发</div>
      <h2>系统"看见"了它：一张卡 = 一个线程</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/def/d1-trigger.png', '触发页', 300)}
        <div class="card"><span class="bar"></span><h3>发生什么</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div>来源每 <b>60 秒</b> 轮询一次看板</div></div>
            <div class="li"><span class="mk dot">·</span><div>卡进入监听列、发起人在名单 → 生成一条<b>触发</b></div></div>
            <div class="li"><span class="mk dot">·</span><div>一张卡 = 一个<b>线程</b>；卡上新消息也落在这个线程</div></div>
            <div class="li"><span class="mk ok">✓</span><div>看什么算 OK：<b>1 分钟内</b>触发页出现线程</div></div>
          </div>
          <p class="small">看不到？看「来源」页 24 小时统计与过滤原因。</p>
        </div>
      </div>
    </div>`)

d.slide('d2-detail', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D2 · 看哪里、看什么</div>
      <h2>触发页与线程的去向</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>你看到的</th><th>含义</th><th>下一步</th></tr>
        <tr><td>已被订阅</td><td>这个线程有活在看</td><td>等评估/工单</td></tr>
        <tr><td>评估中</td><td>正在研判</td><td>等决定</td></tr>
        <tr><td>24 小时内有新触发</td><td>最近有消息进来</td><td>按时间翻</td></tr>
        <tr><td>线程里有"排队 N"</td><td>还有 N 条等评估</td><td>等它消化</td></tr>
      </table>
      <p class="small">线程上后续消息：<b>已有工单</b> → 直接送达工单，不经评估、不产生新决定；<b>没有工单</b> → 回到队列评估。</p>
    </div>`)

d.slide('d3', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D3 · 评估 / 路由</div>
      <h2>接，还是不接：四问 + 三决定</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>推断的候选判四件事</h3>
          <div class="check">
            <div><i>✓</i>是不是在要"实现/修"</div>
            <div><i>✓</i>目标是否明确（截图/既有规范）</div>
            <div><i>✓</i>要不要产品/设计决定</div>
            <div><i>✓</i>有没有证据（能引原话）</div>
          </div>
          <p class="small">再对照启用的规则；结论每条都写理由。</p>
        </div>
        <div class="card g"><span class="bar"></span><h3>三种决定</h3>
          <div class="list">
            <div class="li"><span class="mk ok">●</span><div><b>接单</b> → 变成工单</div></div>
            <div class="li"><span class="mk dot">●</span><div><b>忽略</b> → 不接，写理由</div></div>
            <div class="li"><span class="mk dot">●</span><div><b>未完成</b> → 超时/策略变更</div></div>
          </div>
        </div>
      </div>
    </div>`)

d.slide('d3-eval', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D3 · 评估页</div>
      <h2>每条决定：结果、理由、命中的规则</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/def/d2-eval.png', '评估页', 300)}
        <div class="card"><span class="bar"></span><h3>接单模式三档（只管推断）</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><b>关闭</b>：不评估，直接忽略</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>仅观察</b>：记录"可接单"，不建单</div></div>
            <div class="li"><span class="mk ok">✓</span><div><b>自动接单</b>：评估通过就建单</div></div>
          </div>
          <p class="small">看什么算 OK：出现一行决定，理由一句话能读懂，点开回到线程/工单。</p>
        </div>
      </div>
    </div>`)

d.slide('d4', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D4 · 四道闸门</div>
      <h2>过不了就不建单（决定里写明理由）</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>闸门（按检查顺序）</th><th>不通过时显示</th><th>怎么修</th></tr>
        <tr><td>项目已发布宪章</td><td>这个项目还没有发布宪章，不能开工</td><td>项目与岗位 → 发布宪章</td></tr>
        <tr><td>PM 不执行工人职责</td><td>PM 岗位默认不执行工人职责…</td><td>改派给 Worker；或在宪章写 <code>PM 可执行职责</code></td></tr>
        <tr><td>职责已定义</td><td>卡片声明的职责在职责说明里没有定义</td><td>在 <code>duties/</code> 里加这个 <code>duty:&lt;id&gt;</code></td></tr>
        <tr><td>岗位承接这个职责</td><td>这个职责由别的岗位承接</td><td>岗位卡「接哪些职责」下拉选中它</td></tr>
      </table>
      <p class="small">这四道闸门就是"没有宪章不可开工 / 职责必须先定义 / 岗位必须承接 / PM 不给自己派活"。闸门不过，卡不动、也不建单。</p>
    </div>`)

d.slide('d5', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>D5 · 工单</div>
      <h2>它变成了什么：有授权、有范围、有归属岗位</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/def/d4-ticket.png', '工单页', 300)}
        <div class="card"><span class="bar"></span><h3>工单上有</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><b>标题 / 范围</b>：一件可执行的事</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>授权</b>：强度、发起人、决定、规则、政策版本</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>归属岗位</b>：WIP 按它算</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>职责简报</b>：有 <code>duty:</code> 时开工先读</div></div>
          </div>
        </div>
      </div>
    </div>`)

d.slide('states', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>之后</div>
      <h2>工单状态与去哪里看</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>状态</th><th>含义</th></tr>
        <tr><td>排队中</td><td>已建单，等执行器名额</td></tr>
        <tr><td>执行中</td><td>岗位在干（详见 GHI）</td></tr>
        <tr><td>待验收</td><td>做完了，等人看结果/合并</td></tr>
        <tr><td>已结束</td><td>完成 / 合并 / 关闭 / 人工停止 / 无需处理</td></tr>
      </table>
      <p class="small">在哪看：触发页（线程与触发）· 评估页（决定与理由）· 执行页（工单）· 编队页（在飞职责 / WIP）· 卡片评论（进度与结果）。</p>
    </div>`)

d.slide('drill', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>演练 · 约 3 分钟</div>
      <h2>三种安全程度不同的走法</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>方式</th><th>怎么做</th><th>看什么算 OK</th></tr>
        <tr><td>A 只看历史</td><td>触发 → 评估 → 执行（已结束）→ 点开一张工单</td><td>看清"需求 → 触发 → 决定 → 工单"的对应</td></tr>
        <tr><td>B 看板卡演练</td><td>先暂停执行器，再建测试卡（<code>duty:ui</code>）拖进监听列</td><td>触发出现 → 决定=接单 → 工单排队中；看完停止并删卡</td></tr>
        <tr><td>C 评估演练</td><td>临时关掉「其它来源先入库成卡」，仅观察模式发一条不点名消息</td><td>评估页出现「忽略（可接单，仅观察）」或规则不符；不建单</td></tr>
      </table>
      <p class="small">时间线：T+0 上板/发消息 → T+0～1 分钟触发 → T+1 分钟决定 → 紧接着工单（闸门不过则只有带理由的忽略）。</p>
    </div>`)

d.slide('problems', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>常见 · 没变成工单</div>
      <h2>对着面板找原因</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>现象</th><th>多半原因</th><th>怎么办</th></tr>
        <tr><td>触发页根本没有</td><td>不在监听列 / 名单外 / 标签不符 / 来源没跑</td><td>看「来源」页 24 小时与过滤原因</td></tr>
        <tr><td>有触发，没有决定</td><td>排队等主 Session / 评估中 / 暂停处理</td><td>稍等；查评估中与执行器暂停</td></tr>
        <tr><td>忽略 · 名单外</td><td>卡负责人/创建者不在名单</td><td>评估 → 来源分节加人；或改负责人</td></tr>
        <tr><td>忽略 · 仅观察</td><td>接单模式是"仅观察"</td><td>正式运行改「自动接单」</td></tr>
        <tr><td>忽略 · 无宪章 / 职责 / 岗位 / PM</td><td>四道闸门之一</td><td>按 D4 修</td></tr>
        <tr><td>未完成</td><td>评估超时 / 策略变更</td><td>线程再来一条触发会重新评估</td></tr>
      </table>
    </div>`)

d.slide('closing', 'cover', `
    <div class="glow" style="left:-10%;right:auto"></div><div class="ghost">→</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>DEF · 一句话</div>
      <h1>需求上板或进聊天 →<br><span class="accent">一张有授权的工单</span></h1>
      <p class="lead" style="max-width:46em">看板卡直接路由、聊天候选按规则评估 → 过宪章/职责/岗位闸门 → 工单排队执行。<br>接下来它怎么被干完、怎么反馈与交付：见 GHI。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag">DEF.md · 完整说明</span><span class="tag">GHI.md · 执行与交付</span><span class="tag">ABC.md · 环境</span><span class="tag">SOP.md · 日常</span>
      </div>
    </div>`)

d.write('DEF.html')
