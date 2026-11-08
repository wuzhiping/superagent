/**
 * Builds EA.html: 宪章仓库作为团队能力生产线 in the SOP deck shell, with the AIOS deck's narrative style.
 * Audience: PM and project owners. Thesis → principles → map → operating model → evidence → roadmap → metrics.
 * Every claim is bounded: "已落地 / 待决策 / 愿景" are labeled separately (see EA.md).
 */
import { deck, shot, cover } from './lib/deck-shell.mjs'

const e = deck({ title: 'EA · 宪章仓库：团队的能力生产线', badge: 'SuperAgent · EA' })

e.slide('cover', 'cover active', cover({
  kicker: 'EA · 能力供给 · 落地路线',
  ghost: 'EA',
  title: '宪章仓库，<span class="accent">团队的能力生产线</span>',
  lead: '不只写规则，还要持续供给能力：复盘长出认知，上下文统一认知，知识固化成资产，技能变成可复用的能力，宪章约束下一轮。<br>这是一份给 PM 与项目负责人的落地设计，不是文档清单。',
  tags: ['理念 + 落地', '五层资产', 'PM 四条职责', '12 周路线'],
  meta: [['受众', 'PM / 项目负责人'], ['证据', 'PR #1 · 演练 #45/#46'], ['边界', '12 周目标是愿景，不是现状']],
}))

e.slide('thesis', 'airy', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>THESIS · 它是什么</div>
      <h2>不是文档仓库，是<span class="accent">能力供给系统</span></h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">NOT</div>
          <h3>不只是</h3>
          <div class="list">
            <div class="li"><span class="mk no">✕</span><div>规则文件（README + 职责说明）</div></div>
            <div class="li"><span class="mk no">✕</span><div>Wiki、文档堆、收藏夹</div></div>
            <div class="li"><span class="mk no">✕</span><div>PM 的作业本</div></div>
          </div>
        </div>
        <div class="card w"><span class="bar"></span><div class="num">BUT</div>
          <h3>而是</h3>
          <div class="list">
            <div class="li"><span class="mk ok">✓</span><div>让"团队怎么干活"从个人经验变成<b>可追溯、可复用、可进化</b>的资产</div></div>
            <div class="li"><span class="mk ok">✓</span><div>复盘 → 上下文 → 知识 → 技能 → 宪章，<b>一条持续转动的生产线</b></div></div>
            <div class="li"><span class="mk ok">✓</span><div>PM 的职责从"发宪章、派工"扩展到<b>经营这套资产</b></div></div>
          </div>
        </div>
      </div>
      <p class="small">判断标准只有一条：<b>这些资产有没有让下一轮工作更快、更少返工、更容易复制。</b>没有用的，删掉。</p>
    </div>
  `)

e.slide('why', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>WHY · 为什么现在做</div>
      <h2>单薄的代价，最后都由<span class="accent">交付和新人</span>买单</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>今天的现象</th><th>真实代价</th><th>EA 的对策</th></tr>
        <tr><td>经验留在人脑和聊天记录</td><td>同一个坑反复踩；人一走就断档</td><td>复盘与 KE：结论进仓库、有来源、可检索</td></tr>
        <tr><td>PM 只发宪章、派工、处理异常</td><td>没人对"能力供给"负责，库建了也会荒</td><td>PM 四条运营职责 + 固定节奏</td></tr>
        <tr><td>知识和规则混在一起</td><td>规则被稀释，知识找不到</td><td>五层资产分层：规则、职责、节奏、上下文、知识、技能</td></tr>
        <tr><td>技能靠个人摸索</td><td>能力不可复制、不可审计</td><td>技能库：提取→迭代→测试→发布→退役</td></tr>
      </table>
      <p class="small">一句话：不是"再加几个文件夹"，而是给 PM 一套可执行的运营职责 + 一套有质量门槛的资产结构。</p>
    </div>`)

e.slide('principles', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>DESIGN PRINCIPLES</div>
      <h2>五条原则，保证"建了有人用"</h2>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card k"><span class="bar"></span><div class="num">01</div><h3>少而准</h3><p>一条只讲一件事；不合格就不收（KE 的 MAKE、技能的测试门槛）。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">02</div><h3>可追溯</h3><p>每条资产能指回卡片/工单/复盘；原始记录不复制进仓库。</p></div>
        <div class="card n"><span class="bar"></span><div class="num">03</div><h3>有 Owner</h3><p>每层有负责人与节奏；没有 Owner 的资产不算落地。</p></div>
        <div class="card w"><span class="bar"></span><div class="num">04</div><h3>有门槛</h3><p>复盘有数据、知识过 MAKE、技能有测试，才允许"生效/发布"。</p></div>
        <div class="card pm"><span class="bar"></span><div class="num">05</div><h3>没人用就删</h3><p>月度复盘做资产清理；收藏夹式堆积等于没建。</p></div>
        <div class="card"><span class="bar"></span><div class="num">06</div><h3>分层不越级</h3><p>知识从复盘来、技能从知识/职责来、职责引用宪章；下层不绕过上层。</p></div>
      </div>
    </div>`)

e.slide('map', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>THE MAP · 手里有图</div>
      <h2>六层资产，每层只回答一个问题</h2>
    </div>
    <div class="content">
      <div class="grid g3">
        <div class="card k"><span class="bar"></span><h3>L0 契约</h3><p><b>按什么规则协作？</b>README + CAPABILITY</p></div>
        <div class="card k"><span class="bar"></span><h3>L1 职责</h3><p><b>谁接、怎么干、干到哪算完？</b>duties/</p></div>
        <div class="card g"><span class="bar"></span><h3>L2 节奏</h3><p><b>干得怎么样、下一轮改什么？</b>reviews/</p></div>
        <div class="card g"><span class="bar"></span><h3>L3 上下文</h3><p><b>团队现在共同知道什么？</b>context/</p></div>
        <div class="card n"><span class="bar"></span><h3>L4 知识</h3><p><b>哪些值得留下、放哪、怎么找？</b>KE/</p></div>
        <div class="card pm"><span class="bar"></span><h3>L5 技能</h3><p><b>哪些能力被验证过、哪个版本？</b>skills/</p></div>
      </div>
      <p class="small">三条约束：资产必须可追溯到卡片/复盘；下层引用上层；<b>没人用的资产定期清理</b>。</p>
    </div>`)

e.slide('loop', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>THE LOOP · 生产线怎么转</div>
      <h2>输入 → 复盘 → 上下文 → 知识 → 技能 → 供给</h2>
    </div>
    <div class="content">
      <div class="flow">
        <div class="step"><b>输入</b><span>卡 / 评论 / PR / 异常</span></div><div class="arrow">→</div>
        <div class="step"><b>复盘</b><span>日 / 周 / 月</span></div><div class="arrow">→</div>
        <div class="step"><b>上下文</b><span>最新总结 / 对象 / 本体</span></div><div class="arrow">→</div>
        <div class="step"><b>知识</b><span>KE · MAKE</span></div><div class="arrow">→</div>
        <div class="step"><b>技能</b><span>测试后才发布</span></div><div class="arrow">→</div>
        <div class="step"><b>供给</b><span>宪章 / 职责</span></div>
      </div>
      <div class="grid g2">
        <div class="card g"><span class="bar"></span><h3>供给什么</h3><p>下一轮的规则、职责、上下文、知识与可复用技能——<b>让同样的坑只踩一次</b>。</p></div>
        <div class="card"><span class="bar"></span><h3>凭什么说它有效</h3><p>看指标：复盘按时率、上下文新鲜度、知识复用、技能发布、返工率（见后文）。</p></div>
      </div>
    </div>`)

e.slide('layers-contract-duty', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>L0 + L1 · 契约与职责</div>
      <h2>规则要少，职责要能派工</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>L0 契约</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><b>README</b>：流程、岗位、交付标准、沟通、复盘（每周最多一版）</div></div>
            <div class="li"><span class="mk dot">·</span><div><b>CAPABILITY</b>：资产清单、Owner、节奏、质量门槛、能力地图</div></div>
            <div class="li"><span class="mk ok">✓</span><div>规则只写"必须"和"怎么验收"，不写口号</div></div>
          </div>
        </div>
        <div class="card g"><span class="bar"></span><h3>L1 职责（PM 新增 4 条）</h3>
          <div class="list">
            <div class="li"><span class="mk dot">·</span><div><code>pm-charter-steward</code>：宪章与能力供给</div></div>
            <div class="li"><span class="mk dot">·</span><div><code>pm-retro-curator</code>：复盘与公共上下文</div></div>
            <div class="li"><span class="mk dot">·</span><div><code>pm-context-curator</code>：领域对象与组织本体</div></div>
            <div class="li"><span class="mk dot">·</span><div><code>pm-knowledge-curator</code>：知识库与技能库</div></div>
          </div>
          <p class="small">每条都有目标、输入、载体、完成定义；不是"有空做做"。</p>
        </div>
      </div>
    </div>`)

e.slide('reviews', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>L2 · 复盘</div>
      <h2>复盘不是汇报，是<span class="accent">检查生产线</span></h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>频率</th><th>回答</th><th>主要输入</th><th>产出</th></tr>
        <tr><td>日 10 分钟</td><td>今天卡在哪、明天先干什么</td><td>当日触发/工单/异常</td><td>行动项（Owner+期限）</td></tr>
        <tr><td>周 30 分钟</td><td>哪些做法有效、哪些要改</td><td>日复盘 + 指标 + 典型工单</td><td>≤3 条改进、更新上下文、知识候选</td></tr>
        <tr><td>月 60 分钟</td><td>能力与路线是否还成立</td><td>周复盘 + 趋势 + 资产库存</td><td>下月路线、能力缺口、资产清理</td></tr>
      </table>
      <p class="small">质量门槛：有数据、有 ≤3 条可执行改进、有 Owner 与期限、24 小时内更新 <code>context/retrospectives.md</code>。</p>
    </div>`)

e.slide('context', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>L3 · 公共上下文</div>
      <h2>团队现在<span class="accent">共同知道什么</span></h2>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card"><span class="bar"></span><div class="num">A</div><h3>最新复盘总结</h3><p><code>retrospectives.md</code>：最新结论、指标、未关闭行动项；<b>≤7 天</b>。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">B</div><h3>领域对象</h3><p><code>domain/</code>：定义、属性、关系、规则、证据、<b>有效期</b>。</p></div>
        <div class="card n"><span class="bar"></span><div class="num">C</div><h3>组织本体</h3><p><code>ontology/</code>：组织→岗位→职责→能力→价值流→对象，六层并每月对齐。</p></div>
      </div>
      <p class="small">原则：context 是"当前认知的最短版本"，长文进 KE，原文链接回卡片/工单。</p>
    </div>`)

e.slide('ke', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>L4 · 知识库（KE）</div>
      <h2>P/A/R/T 决定放哪，MAKE 决定收不收</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>四层</h3>
          <div class="list">
            <div class="li"><span class="mk dot">P</span><div><b>Project</b>：有起止的项目知识（决策/里程碑/教训）</div></div>
            <div class="li"><span class="mk dot">A</span><div><b>Area</b>：长期领域的规范/口径/流程</div></div>
            <div class="li"><span class="mk dot">R</span><div><b>Reference</b>：外部资料摘要与索引</div></div>
            <div class="li"><span class="mk dot">T</span><div><b>Task</b>：一次性问题的解法/命令</div></div>
          </div>
        </div>
        <div class="card g"><span class="bar"></span><h3>MAKE 四性</h3>
          <div class="list">
            <div class="li"><span class="mk ok">M</span><div><b>Minimal</b>：一条只讲一件事</div></div>
            <div class="li"><span class="mk ok">A</span><div><b>Actionable</b>：能直接照做</div></div>
            <div class="li"><span class="mk ok">K</span><div><b>Knowledge</b>：解释为什么</div></div>
            <div class="li"><span class="mk ok">E</span><div><b>Experience</b>：来自真实场景，有来源与代价</div></div>
          </div>
          <p class="small">缺 Actionable 或 Experience 的退回；季度复核，过期归档。</p>
        </div>
      </div>
    </div>`)

e.slide('skills', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>L5 · 技能库</div>
      <h2>能力要能被<span class="accent">验证和复用</span></h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>状态</th><th>含义</th><th>进入条件</th><th>退出条件</th></tr>
        <tr><td>draft</td><td>提取中的草稿</td><td>有真实使用场景</td><td>有测试用例</td></tr>
        <tr><td>testing</td><td>真实工单中试用</td><td>至少 1 次真实使用</td><td>通过验收用例</td></tr>
        <tr><td>published</td><td>可被岗位引用</td><td>版本 + Owner + 测试证据</td><td>被替代或失效</td></tr>
        <tr><td>deprecated</td><td>退役</td><td>新版替代/场景消失</td><td>归档保留链接</td></tr>
      </table>
      <p class="small">发布门槛：<code>SKILL.md</code> 完整 + 验收用例 + 版本 + Owner + <code>registry.md</code> 登记。<b>没有测试只能算 draft。</b></p>
    </div>`)

e.slide('pm-duties', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>OPERATING MODEL · 心里有谱</div>
      <h2>PM 的四条运营职责（可派工、可验收）</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>职责</th><th>频次</th><th>完成定义（摘要）</th></tr>
        <tr><td>pm-charter-steward</td><td>每周</td><td>README 版本 +1 且与面板同文；PR 含变更理由/影响/验收/回滚；健康检查无红项</td></tr>
        <tr><td>pm-retro-curator</td><td>日/周/月</td><td>review 落库；≤3 条改进有 Owner+期限；24h 内更新最新复盘总结</td></tr>
        <tr><td>pm-context-curator</td><td>每周/月</td><td>新增/更新 ≥1 个对象或本体节点；有证据与有效期；索引同步</td></tr>
        <tr><td>pm-knowledge-curator</td><td>每周</td><td>KE ≥1 条过 MAKE 并登记；技能至少推进一个状态</td></tr>
      </table>
      <p class="small">喂料顺序：<b>retro → context → KE → skills → 宪章</b>。PM 不是写文档的人，是让资产流动的人。</p>
    </div>`)

e.slide('evidence-1', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>EVIDENCE · 为什么不是纸上谈兵</div>
      <h2>这套方法长在<span class="accent">已经跑通的流水线</span>上</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        ${shot('images/rehearsal/r4-ticket-top.png', '演练工单', 280)}
        <div class="card"><span class="bar"></span><h3>已发生的事实</h3>
          <div class="list">
            <div class="li"><span class="mk ok">✓</span><div>演练卡 #45：建卡 → 接单 → 工单 → MinIO 交付 → done，<b>1 分 48 秒</b></div></div>
            <div class="li"><span class="mk ok">✓</span><div>对照实验 #46：标签先挂 → 工单带「产出类型：文档」</div></div>
            <div class="li"><span class="mk ok">✓</span><div>数据可复核：卡 #45/#46 仍在看板，MinIO 对象可回读</div></div>
          </div>
          <p class="small">来源：A-I.md §11（含截图与时间）。</p>
        </div>
      </div>
    </div>`)

e.slide('evidence-2', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>EVIDENCE · 已先落一版骨架</div>
      <h2>理念有载体，不是空计划</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>已交付</th><th>内容</th><th>验证</th></tr>
        <tr><td>宪章仓库 PR #1</td><td>28 个文件：README v14 · CAPABILITY · reviews/ · context/ · KE/ · skills/ · 4 条 PM 职责</td><td>PR open，28 files</td></tr>
        <tr><td>PM 职责</td><td>4 条 <code>duty:pm-*</code>，按 folder 模式编写</td><td>解析测试 4/4 通过</td></tr>
        <tr><td>模板与索引</td><td>复盘三模板、对象卡模板、KE 模板、技能模板、索引/登记表</td><td>目录契约齐全</td></tr>
      </table>
      <p class="small">诚实边界：这些是"骨架已就位"，<b>还没合并、还没发布、还没跑第一次复盘</b>——下一节就是路。</p>
    </div>`)

e.slide('roadmap', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>ROADMAP · 脚下有路</div>
      <h2>P0 骨架 + 四个阶段，每阶段有验收与回滚</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>阶段</th><th>周期</th><th>做到什么</th><th>怎么验收</th></tr>
        <tr><td>P0 骨架</td><td>本周</td><td>目录/模板/4 条职责 + 宪章 v14</td><td>解析通过；PM 能派 1 张 pm 卡</td></tr>
        <tr><td>P1 复盘跑通</td><td>2–3 周</td><td>日/周复盘 + 最新总结</td><td>连续 2 周日 ≥80%；周 100%</td></tr>
        <tr><td>P2 上下文成形</td><td>4–6 周</td><td>3 个对象卡 + 1 版本体</td><td>有来源/有效期；与职责一致</td></tr>
        <tr><td>P3 知识+技能</td><td>7–10 周</td><td>KE 6 条 + 1–2 技能发布</td><td>索引可检索；技能有测试</td></tr>
        <tr><td>P4 经营化</td><td>11–12 周</td><td>指标运行、能力地图版本化</td><td>5 指标连续 4 周达标</td></tr>
      </table>
      <p class="small">每阶段结束做 15 分钟复盘：哪些资产真的被用了？没人用的删掉。</p>
    </div>`)

e.slide('runbook', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>FIRST WEEK · PM 的落地第一周</div>
      <h2>五张卡，跑出第一批真实资产</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>时间</th><th>动作</th><th>产出</th></tr>
        <tr><td>周一</td><td>读 EA + 宪章；注册/确认 PM 岗位，选中 4 条职责</td><td>岗位与职责映射</td></tr>
        <tr><td>周二</td><td>派 <code>pm-retro-curator</code> 卡，跑第一次周复盘</td><td><code>reviews/weekly/</code> + 最新总结更新</td></tr>
        <tr><td>周三</td><td>派 <code>pm-knowledge-curator</code> 卡，提炼 3 条 KE</td><td><code>KE/</code> 条目 + 索引</td></tr>
        <tr><td>周四</td><td>派 <code>pm-context-curator</code> 卡，写 1 个对象 + 本体草案</td><td><code>context/domain</code> + <code>ontology</code></td></tr>
        <tr><td>周五</td><td>派 <code>pm-charter-steward</code> 卡，宪章改版 + 15 分钟复盘</td><td>README v15 + 复盘记录</td></tr>
      </table>
      <p class="small">验收：4 张 PM 卡全部 done，评论里有 PR 链接；仓库有对应文件；最新总结指向本周复盘。</p>
    </div>`)

e.slide('metrics', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>METRICS · 言之有理</div>
      <h2>一个北极星 + 五个先行指标</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>指标</th><th>定义</th><th>12 周目标</th></tr>
        <tr><td>能力复用率（北极星）</td><td>被 ≥2 张不同卡片/复盘引用的生效资产 ÷ 生效资产总数</td><td>≥0.5</td></tr>
        <tr><td>复盘按时率</td><td>按时完成的日/周复盘 ÷ 应完成数</td><td>日 ≥80%，周 100%</td></tr>
        <tr><td>上下文新鲜度</td><td>最新复盘 ≤7 天且指针正确</td><td>100%</td></tr>
        <tr><td>KE 合格率</td><td>过 MAKE 的生效条目 ÷ 总条目</td><td>≥80%；累计 ≥10</td></tr>
        <tr><td>技能发布数</td><td>published 状态技能数</td><td>≥2（含测试）</td></tr>
        <tr><td>返工率</td><td>缺上下文/知识导致的返工 ÷ 总工单（P0 末为基线）</td><td>相对基线下降 ≥30%</td></tr>
      </table>
    </div>`)

e.slide('state', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>CURRENT STATE · 诚实区分</div>
      <h2>已落地 / 待决策 / 愿景</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>状态</th><th>事实</th><th>证据</th></tr>
        <tr><td>已落地</td><td>A-I 流水线可运行（1 分 48 秒闭环）；宪章仓库 PR #1（28 文件）；4 条 PM 职责解析通过</td><td>A-I §11；PR #1；解析测试</td></tr>
        <tr><td>待决策</td><td>PR 合并；面板发布 README v14；注册 PM 岗位；第一次周复盘</td><td>EA §10/§14</td></tr>
        <tr><td>愿景（12 周）</td><td>KE ≥10、技能 ≥2 published、本体 v1、5 指标连续 4 周达标</td><td>EA §11–§12（目标）</td></tr>
      </table>
      <p class="small">不把"目标"说成"现状"；不把"骨架"说成"运行"。</p>
    </div>`)

e.slide('risks', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>RISKS · 边界与对策</div>
      <h2>最可能失败的五种方式</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>风险</th><th>对策</th></tr>
        <tr><td>形式主义：建了没人用</td><td>月度清理；复盘必须产出行动项；没用的资产删掉</td></tr>
        <tr><td>PM 负荷过重</td><td>先跑 retro + knowledge 两条；日复盘 10 分钟封顶；数据整理可分给 Worker</td></tr>
        <tr><td>与面板/卡片重复</td><td>README 以面板发布为准；仓库只放提炼资产，原文链接回卡</td></tr>
        <tr><td>知识质量差</td><td>MAKE 门槛 + 查重 + 季度复核；不合格拒收并写理由</td></tr>
        <tr><td>技能不可信</td><td>发布必须有测试证据与版本；draft/testing 不得被引用</td></tr>
      </table>
    </div>`)

e.slide('closing', 'cover', `
    <div class="glow" style="left:-10%;right:auto"></div><div class="ghost">✓</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>EA · 收尾</div>
      <h1>手里有图，心里有谱，<br><span class="accent">脚下有路，言之有理</span></h1>
      <p class="lead" style="max-width:46em">六层资产是图；PM 四条职责与指标是谱；P0–P4 与第一周 runbook 是路；<br>演练数据、PR #1 与解析测试是理。下一步只有四件事：合并 PR、发布宪章、注册 PM、跑第一次复盘。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag">EA.md · 完整设计</span><span class="tag">PR #1 · 骨架</span><span class="tag">A-I.md · 运行证据</span><span class="tag">ABC.md · 环境</span>
      </div>
    </div>`)

e.write('EA.html')
