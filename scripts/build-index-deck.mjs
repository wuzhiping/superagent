/**
 * Builds INDEX.html: a reading map for the eight root PDFs (same SOP deck shell).
 * Audience: anyone opening the repository for the first time; it explains purpose and reading order.
 */
import { deck, cover } from './lib/deck-shell.mjs'

const i = deck({ title: 'INDEX · 根目录 PDF 阅读地图', badge: 'SuperAgent · INDEX' })

i.slide('cover', 'cover active', cover({
  kicker: 'INDEX · 阅读地图 · 8 份 · 151 页',
  ghost: 'INDEX',
  title: '先看哪本，<span class="accent">后看哪本</span>',
  lead: '根目录的 8 份 16:9 演示稿各有分工，互相引用。这份索引说明：每份解决什么问题、按什么顺序读、遇到问题时先翻哪本。<br>不要随机翻。',
  tags: ['总览 A-I', '操作 ABC/DEF/GHI', '体系 EA', '理念 AIOS', '手册 SOP', '故事 STORY'],
  meta: [['文件', '8 份 PDF · 151 页'], ['先行', 'A-I 第 1–3 页'], ['文字版', 'INDEX.md']],
}))

i.slide('what', 'airy', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>这批 PDF 是什么</div>
      <h2>同一套 16:9 外壳，<span class="accent">四种用途</span></h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><h3>来源</h3><p>每份 PDF 都由根目录同名 <b>.md</b> 生成（HTML 用 SOP 同款外壳，PDF 为 960×540）；文字版更全，PDF 适合投影与快速通读。</p></div>
        <div class="card g"><span class="bar"></span><h3>用途分层</h3><p><b>总览</b> A-I · <b>操作链</b> ABC/DEF/GHI · <b>体系</b> EA · <b>理念</b> AIOS · <b>手册</b> SOP · <b>故事</b> STORY。</p></div>
      </div>
      <p class="small">共同点：都指向同一套可运行系统（DSH bundle <code>dsh-superagent</code>）与同一份宪章仓库；不是互不相关的课件。</p>
    </div>`)

i.slide('paths', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>三条路 · 按目标选</div>
      <h2>先定目标，再定顺序</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>你的目标</th><th>阅读顺序</th><th>用时</th></tr>
        <tr><td>第一次接触，想先跑起来</td><td><b>A-I → ABC → DEF → GHI</b></td><td>约 2 小时</td></tr>
        <tr><td>要搭/修宪章与能力体系</td><td><b>EA → ABC（职责/宪章）→ A-I（全景）</b></td><td>约 1.5 小时</td></tr>
        <tr><td>要理解"为什么"或给别人讲</td><td><b>AIOS → STORY → A-I → EA</b></td><td>约 2 小时</td></tr>
        <tr><td>日常操作，当手册查</td><td><b>SOP</b> 为主；细节回查 ABC/DEF/GHI</td><td>随用随查</td></tr>
      </table>
      <p class="small">共同起点：<b>A-I</b> 是唯一把"准备 → 触发 → 工单 → 执行 → 交付"串成一条线的总览，先看它不会错。</p>
    </div>`)

i.slide('order', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>推荐次序 · 8 份</div>
      <h2>从全景到局部，再到手册与故事</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>#</th><th>文件</th><th>一句话用途</th><th>页</th><th>读完能做什么</th></tr>
        <tr><td>①</td><td>A-I.pdf</td><td>九节完整流水线 + 真实演练</td><td>22</td><td>知道整条链路与每步看哪里</td></tr>
        <tr><td>②</td><td>ABC.pdf</td><td>把运行环境准备好</td><td>16</td><td>独立完成环境准备并确认就绪</td></tr>
        <tr><td>③</td><td>DEF.pdf</td><td>需求怎么变成工单</td><td>16</td><td>看懂接/不接、为什么没变成工单</td></tr>
        <tr><td>④</td><td>GHI.pdf</td><td>工单怎么执行、反馈与交付</td><td>21</td><td>跟执行、处理卡点、验收交付</td></tr>
        <tr><td>⑤</td><td>EA.pdf</td><td>宪章仓库升级为能力供给系统</td><td>20</td><td>设计复盘/context/KE/技能的运营</td></tr>
        <tr><td>⑥</td><td>AIOS.pdf</td><td>为什么是"组织操作系统"</td><td>18</td><td>解释设计逻辑与边界</td></tr>
        <tr><td>⑦</td><td>SOP.pdf</td><td>日常操作手册</td><td>22</td><td>按角色执行日常 SOP</td></tr>
        <tr><td>⑧</td><td>STORY.pdf</td><td>用户故事：小吴的一天</td><td>16</td><td>用故事把概念串成直觉</td></tr>
      </table>
    </div>`)

i.slide('docs-1', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>① ② · 总览与环境</div>
      <h2>A-I 与 ABC</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">① A-I · 22 页</div><h3>完整流水线与演练</h3><p>九节 A–I：准备 → 登记 → 触发 → 判断 → 闸门 → 执行 → 反馈 → 异常 → 交付；附真实演练 #45/#46（1 分 48 秒闭环）。</p><p class="small">最适合：第一次通读；确认"现在卡在哪一步"。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">② ABC · 16 页</div><h3>只把环境准备好</h3><p>四张来源卡、最少必填、每步"看什么算 OK"、8 项自检；新增"建卡 4 条"（标签先挂）。</p><p class="small">最适合：新机器/新项目初始化。</p></div>
      </div>
    </div>`)

i.slide('docs-2', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>③ ④ · 需求与执行</div>
      <h2>DEF 与 GHI</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">③ DEF · 16 页</div><h3>需求怎么变成工单</h3><p>两条入口（看板卡/聊天）；显式请求直接路由、推断候选才评估；四道闸门与工单字段。</p><p class="small">最适合：PM 判断该不该接；排查卡没变成工单。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">④ GHI · 21 页</div><h3>工单怎么被执行与交付</h3><p>派工/目录/提示词五层、五种报告、异常状态表、载体（PR / MinIO / 评论）与部署清理。</p><p class="small">最适合：Worker 开工前；PM 跟进度与处理异常。</p></div>
      </div>
    </div>`)

i.slide('docs-3', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>⑤ ⑥ · 体系与理念</div>
      <h2>EA 与 AIOS</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">⑤ EA · 20 页</div><h3>能力供给体系</h3><p>宪章仓库六层模型、PM 四条运营职责、P0–P4 路线与指标；诚实区分"已落地 / 待决策 / 愿景"。</p><p class="small">最适合：PM/负责人设计组织能力；决定复盘与知识怎么常态化。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">⑥ AIOS · 18 页</div><h3>为什么这样设计</h3><p>六条设计原则、叙事与实现的对应、组织/工作对象模型、治理与复制；末尾标注现状边界。</p><p class="small">最适合：对外讲这套系统；理解设计取舍。</p></div>
      </div>
    </div>`)

i.slide('docs-4', '', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>⑦ ⑧ · 手册与故事</div>
      <h2>SOP 与 STORY</h2>
    </div>
    <div class="content">
      <div class="grid g2 fill">
        <div class="card"><span class="bar"></span><div class="num">⑦ SOP · 22 页</div><h3>日常操作手册</h3><p>PM 与 Worker 各自怎么干：岗位与职责、派工、异常、复盘、宪章维护；规则细节最全。</p><p class="small">最适合：接手项目第一周；随用随查。</p></div>
        <div class="card g"><span class="bar"></span><div class="num">⑧ STORY · 16 页</div><h3>超级智能体的一天</h3><p>用一个人物、一天的三条消息流，讲清从接单到交付的体验；偏叙事、少配置。</p><p class="small">最适合：给非技术同事介绍；培训开场。</p></div>
      </div>
    </div>`)

i.slide('questions', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>按问题找入口</div>
      <h2>先翻哪本，取决于你的问题</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>你现在的疑问</th><th>先看</th></tr>
        <tr><td>这套系统到底怎么运转？</td><td>A-I → STORY</td></tr>
        <tr><td>环境怎么准备？检查为什么红？</td><td>ABC</td></tr>
        <tr><td>卡为什么没被接？决定了什么？</td><td>DEF</td></tr>
        <tr><td>工单卡住/失败/要人回答怎么办？</td><td>GHI（异常章）</td></tr>
        <tr><td>复盘/知识库/技能怎么搞？宪章仓库怎么升级？</td><td>EA</td></tr>
        <tr><td>这些设计为什么成立？边界在哪？</td><td>AIOS（现状页）</td></tr>
        <tr><td>每天具体怎么操作？</td><td>SOP</td></tr>
        <tr><td>怎么给新同事讲明白？</td><td>STORY → AIOS</td></tr>
      </table>
    </div>`)

i.slide('maintain', 'dense', `
    <div class="head">
      <div class="kicker"><span class="dot"></span>维护 · 重新生成</div>
      <h2>索引与 PDF 一起进版本管理</h2>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>动作</th><th>命令 / 规则</th></tr>
        <tr><td>生成某份 HTML</td><td><code>node scripts/build-&lt;name&gt;-deck.mjs</code>（A-I/ABC/DEF/GHI/EA/AIOS）</td></tr>
        <tr><td>转 PDF</td><td><code>node scripts/html-to-pdf.mjs &lt;name&gt;.html &lt;name&gt;.pdf</code></td></tr>
        <tr><td>SOP / STORY</td><td>HTML 是手工维护的源文件，改完直接转 PDF</td></tr>
        <tr><td>新增/删除 PDF</td><td>同步改 INDEX.md 的清单、页数与路径；INDEX.html/pdf 重新生成</td></tr>
      </table>
      <p class="small">本索引文字版：<code>INDEX.md</code>；演示版：<code>INDEX.html</code> / <code>INDEX.pdf</code>（11 页）。</p>
    </div>`)

i.slide('closing', 'cover', `
    <div class="glow" style="left:-10%;right:auto"></div><div class="ghost">→</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>INDEX · 一句话</div>
      <h1>先看 <span class="accent">A-I 前三页</span>，<br>再按目标选路</h1>
      <p class="lead" style="max-width:46em">想跑起来：A-I → ABC → DEF → GHI；想搭体系：EA → ABC → A-I；<br>想讲清楚：AIOS → STORY → A-I → EA。不要从 SOP 细节开始，容易只见树木。</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag">INDEX.md · 文字版</span><span class="tag">A-I.pdf · 先看</span><span class="tag">EA.pdf · 体系</span><span class="tag">SOP.pdf · 手册</span>
      </div>
    </div>`)

i.write('INDEX.html')
