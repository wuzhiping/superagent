/**
 * Builds GHI.html: 一张工单怎么被执行、反馈与交付 in the SOP deck shell.
 * Mirrors GHI.md one slide per section, with real panel screenshots.
 */
import { deck, shot, cover } from './lib/deck-shell.mjs'

const g = deck({ title: 'GHI · 一张工单怎么被执行、反馈与交付', badge: 'SuperAgent · GHI' })

g.slide('cover', 'cover active', cover({
  kicker: 'GHI · 执行 · 反馈 · 交付',
  ghost: 'GHI',
  title: '一张工单，<span class="accent">怎么被执行完</span>',
  lead: '工单被谁领走、在哪个目录里干、提示词怎么指挥它、进度和异常怎么回到面板、结果怎么交付与部署。',
  tags: ['GHI.md · 配图走一遍', 'DEF.md · 上一环', 'ABC.md · 环境', 'SOP.md · 日常'],
  meta: [['目标', '看懂执行、反馈与交付'], ['给谁看', 'PM 8 分钟 · Worker 看 §3–§6'], ['前提', '工单已建好']],
}))

g.slide('overview', 'airy', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>30 秒全貌</div>
      <h2>派工 → 执行 → 报告 → 交付 → 验收</h2>
    </div>
    <div class="content">
      <div class="flow">
        <div class="step"><b>① 派工</b><span>会话 + 工作目录</span></div><div class="arrow">→</div>
        <div class="step"><b>② 执行</b><span>按提示词干活</span></div><div class="arrow">→</div>
        <div class="step"><b>③ 报告</b><span>进度 / 可验收 / 受阻</span></div><div class="arrow">→</div>
        <div class="step"><b>④ 交付</b><span>PR / MinIO / 评论</span></div><div class="arrow">→</div>
        <div class="step"><b>⑤ 验收</b><span>人看结果后结束</span></div>
      </div>
      <div class="grid g2">
        <div class="card g"><span class="bar"></span><h3>执行器只报告</h3><p>不直接改看板、不发 IM；宿主把报告落成卡片评论、移列、通知人。</p></div>
        <div class="card"><span class="bar"></span><h3>结果必须有载体</h3><p>代码 → PR；文档/方案 → MinIO 对象；其余 → 卡片评论。没有载体不算 ready。</p></div>
      </div>
      <p class="small">卡住时不用慌：状态字典告诉你它在等什么，以及你该做什么。</p>
    </div>`)

g.slide('vocabulary', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>术语 · 面板里就用这些词</div>
      <h2>先把六个词对齐</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>词</th><th>在这里的意思</th></tr>
        <tr><td>执行器 Executor</td><td>真正干活的那个 Session，一个工单一个（<code>worker-&lt;工单 id&gt;</code>）</td></tr>
        <tr><td>工作目录</td><td>这个工单专用的文件夹；名字来自工单短名 + 工单 id 前 12 位</td></tr>
        <tr><td>派工 Assignment</td><td>"把这张工单交给执行器"的一次记录；重试会开新的派工</td></tr>
        <tr><td>报告 Report</td><td>执行器向宿主汇报：进展、可验收、受阻、失败、无需处理</td></tr>
        <tr><td>载体</td><td>结果放在哪：代码 PR / MinIO 对象 / 卡片评论</td></tr>
        <tr><td>待验收</td><td>执行器说"做完了"，等人看结果、合并 PR 或确认</td></tr>
      </table>
    </div>`)

g.slide('settings', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>依赖 · 执行这一步用到的设置</div>
      <h2>各自管什么、保存后什么时候生效</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>设置</th><th>管什么</th><th>生效时机</th></tr>
        <tr><td>执行器模型</td><td>干活用哪个模型</td><td>只对新建的执行器会话</td></tr>
        <tr><td>并行工单数</td><td>同时跑几张（另有人插队名额）</td><td>之后新开的工单</td></tr>
        <tr><td>执行目录 / 准备命令</td><td>工作目录建在哪、首次开工前跑什么</td><td>下一张工单</td></tr>
        <tr><td>禁止的命令</td><td>按命令名拦截（护栏，不是安全边界）</td><td>立即</td></tr>
        <tr><td>提示词</td><td>执行器读什么、怎么沟通、何时停、交付要求</td><td>下一次模型请求（不重启）</td></tr>
        <tr><td>来源设置</td><td>看板 / 仓库 / 通知的账号与列</td><td>保存会重启；运行中的派工带恢复说明重开</td></tr>
      </table>
    </div>`)

g.slide('h1', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H1 · 派工</div>
      <h2>工单怎么开工：五步</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>开工五步</h3>
          <div class="list">
            <div class="li"><span class="mk dot">1</span><div><b>排队</b>：按并行数领活，满了就等</div></div>
            <div class="li"><span class="mk dot">2</span><div><b>准备目录</b>：首次跑准备命令（10 分钟）</div></div>
            <div class="li"><span class="mk dot">3</span><div><b>建会话</b>：<code>worker-&lt;工单 id&gt;</code></div></div>
            <div class="li"><span class="mk dot">4</span><div><b>派工消息</b>：范围 + 规则 + 职责简报</div></div>
            <div class="li"><span class="mk ok">5</span><div><b>进认领列</b>：宿主把卡移到 <code>in-progress</code></div></div>
          </div>
        </div>
        <div class="card g"><span class="bar"></span><h3>看什么算 OK</h3>
          <div class="list">
            <div class="li"><span class="mk ok">✓</span><div>执行页 1 分钟内出现工单：排队中 → 执行中</div></div>
            <div class="li"><span class="mk ok">✓</span><div>工单页派工历史里多了一条记录</div></div>
            <div class="li"><span class="mk ok">✓</span><div>卡片移到了认领列</div></div>
          </div>
          <p class="small">准备命令失败 = 工单失败并记录输出；修好后重试或人发一条消息会再准备。</p>
        </div>
      </div>
    </div>`)

g.slide('h2-layers', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H2 · 提示词</div>
      <h2>五层，从硬到软</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>层级</th><th>内容</th><th>谁改得动</th></tr>
        <tr><td>1 工具与宿主硬约束</td><td>身份、权限、工具参数校验、回复用途、长度限制</td><td>改不了（代码）</td></tr>
        <tr><td>2 内置 + 按设置生成</td><td>共享约定、执行器角色、订阅、回复、工作、交付与确认、执行环境、策略</td><td>提示词页（可覆写）</td></tr>
        <tr><td>3 规则流程</td><td>这张工单命中的规则自带的流程与沟通要求</td><td>评估 → 规则</td></tr>
        <tr><td>4 团队小节 + 技能</td><td>沟通方式 / 工单范围 / 交付要求 + 自建技能</td><td>提示词页</td></tr>
        <tr><td>5 外部文本</td><td>卡片、评论、文档、引用</td><td>只是数据，不能改规矩</td></tr>
      </table>
      <p class="small">改提示词 ≠ 改闸门/授权：工具校验、Mandate、账号包装都在代码里。</p>
    </div>`)

g.slide('h2-prompts', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H2 · 提示词设置</div>
      <h2>改什么、谁读到、什么时候生效</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/ghi/g1-prompts.png', '提示词设置', 300)}
        <div class="card"><span class="bar"></span><h3>三个团队小节</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><b>沟通方式</b>：何时通知人、消息怎么写、Review 怎么回</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>工单范围</b>：何时继续、何时停下来交草稿</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>交付要求</b>：PR 证据、自动合并条件、提交作者</div></div>
          </div>
          <p class="small">保存不重启；下一次模型请求就用新文本。内置段落可覆写；升级后默认变了会标「默认内容已更新」。</p>
        </div>
      </div>
    </div>`)

g.slide('h2-reads', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H2 · 执行器还读什么</div>
      <h2>派工说明、宪章、仓库说明</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>还会读</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><b>派工说明</b>：范围 + 职责简报；截断处按 <code>ticket/…</code> 读全文</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>宪章</b>：开工第一步读，报版本与载体</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>仓库 AGENTS.md</b> 与仓库要求的检查</div></div>
          </div>
          <p class="small">人的消息直达工单；超范围就交还（handback），不自己扩大授权。</p>
        </div>
        ${shot('images/ghi/g2-execution-settings.png', '执行设置', 300)}
      </div>
    </div>`)

g.slide('h3', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H3 · 干活（上）</div>
      <h2>读 → 定 → 做</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">01</div><h3>读</h3><p>宪章 → 职责简报 → 卡片/线程 → 仓库说明；拿不准按范围小的一边做。</p></div>
        <div class="card"><span class="bar"></span><div class="num">02</div><h3>定方案</h3><p>自己决定做法；要产品/设计决定的，停下来报告而不是猜。</p></div>
        <div class="card"><span class="bar"></span><div class="num">03</div><h3>做</h3><p>在工作目录里改文件、跑命令；长命令转后台，不堵消息。</p></div>
        <div class="card g"><span class="bar"></span><h3>原则</h3><p><b>范围小的一边做</b>；要产品/设计决定就停下来，不猜。</p></div>
      </div>
    </div>`)

g.slide('h3b', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H3 · 干活（下）</div>
      <h2>查 → 交</h2>
    </div>
    <div class="content">
      <div class="tl">
        <div class="row"><div class="time">04</div><div class="rail"><i></i></div><div class="body"><b>查</b><p>跑仓库要求的检查，自己审一遍</p></div></div>
        <div class="row"><div class="time">05</div><div class="rail"><i></i></div><div class="body"><b>交</b><p>放进载体、回读确认、再报告</p></div></div>
      </div>
      <div class="grid g2">
        <div class="card g"><span class="bar"></span><h3>长命令</h3><p>自动转后台任务；结束后会唤醒它，不堵消息。</p></div>
        <div class="card"><span class="bar"></span><h3>范围</h3><p>人发的消息直达工单；超范围就交还（handback），不自己扩大授权。</p></div>
      </div>
    </div>`)

g.slide('h4-report', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H4 · 报告</div>
      <h2>五种报告，一眼看出它在等你什么</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>报告</th><th>含义</th><th>面板上</th><th>卡片/消息</th></tr>
        <tr><td>progress</td><td>还在干、阶段性进展</td><td>执行中</td><td>内部；答人问题时会带出去</td></tr>
        <tr><td>ready</td><td>可验收（有 PR = 待验收；无 PR = 完成）</td><td>待验收</td><td>结果写回评论</td></tr>
        <tr><td>blocked</td><td>缺前置、要人处理</td><td>待处理受阻</td><td>写清卡点</td></tr>
        <tr><td>failed</td><td>执行失败</td><td>待处理失败</td><td>记录错误；网络类先自动重试 3 次</td></tr>
        <tr><td>dropped</td><td>没什么要做的</td><td>已结束（无需处理）</td><td>静默；后续消息可恢复</td></tr>
      </table>
      <p class="small">执行器只报告，宿主写评论、移列（认领列 → 交付列）、通知人。</p>
    </div>`)

g.slide('h4-board', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H4 · 看板与工单页</div>
      <h2>进度回到哪里</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/ghi/g5-ticket.png', '工单页', 300)}
        <div class="card"><span class="bar"></span><h3>工单页能看到</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div>状态与可做的操作</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>授权详情</b>：强度、发起人、决定、规则、范围、政策版本</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>未送达的输入</b>与<b>订阅的线程</b></div></div>
            <div class="li"><span class="mk dot">·</span><div><b>派工历史</b>：几次派工、时间与报告</div></div>
          </div>
          <p class="small">编队页看每个岗位的「在飞职责 / WIP」；执行页按状态筛选。</p>
        </div>
      </div>
    </div>`)

g.slide('h4-bottom', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H4 · 页面往下</div>
      <h2>未送达的输入、订阅的线程、派工历史</h2>
    </div>
    <div class="content">
      ${shot('images/ghi/g5-ticket-bottom.png', '工单页下部', 470)}
    </div>`)

g.slide('h5', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H5 · 异常</div>
      <h2>卡住了怎么办：先看状态，再对号入座</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>你看到的</th><th>含义</th><th>你做什么</th></tr>
        <tr><td>排队中</td><td>等并行名额</td><td>正常等；想快就调大并行数</td></tr>
        <tr><td>待回答</td><td>它提了一个具体问题</td><td>在卡片/线程回答</td></tr>
        <tr><td>待验收</td><td>做完了等人看</td><td>看结果/PR；合并或确认</td></tr>
        <tr><td>待处理受阻</td><td>缺前置（权限/凭据/信息）</td><td>补上后回消息，或点重试</td></tr>
        <tr><td>待处理失败</td><td>启动/执行出错</td><td>修好后重试（同会话/目录/PR 继续）</td></tr>
        <tr><td>输入未送达</td><td>消息没送到执行器</td><td>自动重试；仍失败可重试</td></tr>
        <tr><td>等待新触发</td><td>这轮干完，没等人</td><td>线程新消息会唤醒</td></tr>
        <tr><td>已结束</td><td>完成/合并/关闭/停止/无需处理</td><td>看结果；按需清理</td></tr>
      </table>
    </div>`)

g.slide('h5-switches', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H5 · 兜底开关</div>
      <h2>暂停、停止、重试、接手</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>暂停处理</h3><p>不派新工单、不评估、不回复；正在跑的回合不打断。人发的消息等恢复。</p></div>
        <div class="card"><span class="bar"></span><h3>停止工单</h3><p>结束当前派工，<b>保留</b>会话与工作目录；收回授权，之后线程消息不自动恢复。</p></div>
        <div class="card g"><span class="bar"></span><h3>重试</h3><p>同一会话、目录、分支、PR 继续；失败/受阻/输入未送达时可用。</p></div>
        <div class="card n"><span class="bar"></span><h3>重启/升级</h3><p>运行中的派工中断后带"检查目录、git 历史、PR 再继续"重开；其余状态保持。</p></div>
      </div>
    </div>`)

g.slide('h6-carrier', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H6 · 交付</div>
      <h2>结果放在哪：载体由产出类型决定</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>产出类型</th><th>载体</th><th>回写</th></tr>
        <tr><td><code>kind:code</code></td><td>代码 PR；<code>repo:owner/name</code> 说明动哪个仓库</td><td>PR 链接 + 评审状态</td></tr>
        <tr><td><code>doc</code> / <code>plan</code> / <code>memo</code> / <code>log</code></td><td>MinIO 对象：<code>deliverables/&lt;项目&gt;/&lt;工单&gt;/&lt;文件&gt;</code>，写完回读</td><td><code>bucket/key</code> + 一句摘要</td></tr>
        <tr><td>其他（报价、合同、投诉、物流回执…）</td><td>卡片评论（追加式）</td><td>结论 + 状态推进</td></tr>
      </table>
      <p class="small">卡片评论只写进度与结果，正文/文件放载体；同一 key 覆盖即修订，不撒版本。</p>
    </div>`)

g.slide('h6-done', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H6 · 交付完成</div>
      <h2>什么算"交付完成"</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>有 PR</h3><p>ready = <b>待验收</b>；PR 合并/关闭后工单才结束，并记结果（完成/合并/关闭）。</p></div>
        <div class="card g"><span class="bar"></span><h3>没有 PR</h3><p>ready 直接结束为<b>已完成</b>；什么都不用做时 dropped 静默结束。</p></div>
        <div class="card n"><span class="bar"></span><h3>半成品</h3><p>blocked，并写清草稿在哪、还差什么——<b>不算 ready</b>。</p></div>
        <div class="card"><span class="bar"></span><h3>UI 变更</h3><p>PR 描述要有 <b>Before 和 After</b> 两张证据；只有 After 不算完成。</p></div>
      </div>
    </div>`)

g.slide('h6-deploy', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>H6 · 部署与清理</div>
      <h2>宿主这一侧：状态目录、部署检查、收尾</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/ghi/g3-deployment.png', '部署页', 260)}
        ${shot('images/ghi/g4-maintenance.png', '清理页', 260)}
      </div>
      <p class="small">部署页：状态目录（工件、会话、设置都在这里）与部署检查。清理页：已结束职责的工作区与 Session 登记；默认只解除登记、不删目录，Session 日志不会删。</p>
    </div>`)

g.slide('drill', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>演练 · 约 5 分钟</div>
      <h2>用一张低风险卡走完整闭环</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>时刻</th><th>你应该看到</th></tr>
        <tr><td>T+0</td><td>建卡（负责人 = Worker 岗位、<code>duty:doc</code>）并拖进监听列</td></tr>
        <tr><td>T+0～1 分钟</td><td>触发 → 决定 → 工单（DEF 的流程）</td></tr>
        <tr><td>T+1～5 分钟</td><td>执行页：排队中 → 执行中；卡片进认领列</td></tr>
        <tr><td>完成时</td><td>报告 ready/blocked/failed；评论里有 <code>bucket/key</code> 或结论；卡片进交付列</td></tr>
        <tr><td>之后</td><td>MinIO 里能回读文件；清理页看到该工单的工作区</td></tr>
      </table>
      <p class="small">想看异常：在卡上留一句"需要更多信息"，会看到待回答；补上后再看它继续。</p>
    </div>`)

g.slide('problems', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>常见 · 按现象找</div>
      <h2>执行阶段最容易撞到的几个</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>现象</th><th>多半原因</th><th>怎么办</th></tr>
        <tr><td>一直排队</td><td>并行数满 / 暂停 / 模型不可用</td><td>看"执行中 x/y"；调并行数或恢复</td></tr>
        <tr><td>一直执行中没动静</td><td>长命令在后台 / 模型慢 / 准备命令卡住</td><td>看派工历史与 Session；准备命令 10 分钟失败</td></tr>
        <tr><td>准备命令失败</td><td>目录、权限、git 克隆失败</td><td>工单页有输出；修好后重试</td></tr>
        <tr><td>消息没反应</td><td>工单已结束 / 暂停 / 输入未送达</td><td>看状态；已结束的线程会重新评估或恢复</td></tr>
        <tr><td>交付物找不到</td><td>只写了本地路径 / key 错</td><td>载体必须是 <code>bucket/key</code>，回读后再报告</td></tr>
        <tr><td>PR 没合并、工单没结束</td><td>待验收，等人合并</td><td>合并/关闭 PR，或配置自动合并</td></tr>
      </table>
    </div>`)

g.slide('closing', 'cover', `
    <div class="glow" style="left:-10%;right:auto"></div><div class="ghost">✓</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>GHI · 一句话</div>
      <h1>领走 → 按提示词干 →<br><span class="accent">报告 → 交付 → 验收</span></h1>
      <p class="lead" style="max-width:46em">结果放进 PR / MinIO / 评论；卡住按状态对号入座；交付完再清理工作区。<br>上一环：需求怎么变成工单——见 DEF。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag">GHI.md · 完整说明</span><span class="tag">DEF.md · 上一环</span><span class="tag">ABC.md · 环境</span><span class="tag">SOP.md · 日常</span>
      </div>
    </div>`)

g.write('GHI.html')
