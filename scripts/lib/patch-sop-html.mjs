import { readFileSync, writeFileSync } from 'node:fs'

const path = 'SOP.html'
const source = readFileSync(path, 'utf8')
const start = source.indexOf('  <!-- 9 PM weekly charter -->')
const end = source.indexOf('  <!-- 11 worker delivery -->')
if (start < 0 || end < 0 || end <= start) { console.log('markers not found'); process.exit(1) }

const replacement = `  <!-- 9 PM weekly charter -->
  <section class="slide">
    <div class="head">
      <div class="kicker"><span class="dot"></span>PM · WEEKLY</div>
      <h2>先复盘，再发宪章：流程是长出来的</h2>
    </div>
    <div class="content">
      <div class="cols">
        <div class="card pm"><span class="bar"></span>
          <h3>周复盘 → 新流程</h3>
          <p>看板不是固定的任务表，而是<b>一条不断迭代的价值流</b>。</p>
          <p>看这一轮的工作日志 → 哪一列总堵、哪一步没意义 → <b>推荐新的状态</b> → 与岗位达成共识 → 确认。</p>
          <p>确认后写进宪章新版本，并在面板 <b>设置 → 项目与岗位 → 流程</b> 同步列语义。</p>
        </div>
        <pre>version: 5
publishedBy: sa-pm-fdep

<b># 宪章 v5</b>
- 当期流程（列语义与流转）：
  to-do 待辦池 → ready 待開工
  → in-progress 進行中 → in-review 待評審
  → done 完成
- 角色与职责：PM 管流程与异常；Worker 领自己的卡
- 交付标准：代码 → Gitea PR；文档/方案 → MinIO；
  报价/合同/客诉 → 任务评论 + 状态推进
- WIP 上限：每岗位 3
- 回写规则：状态 + 工作日志 + 产出引用
- 当前工作面集与 topic 集</pre>
      </div>
      <p class="small">面板编队页会把<b>看板的列</b>与<b>宪章声明的列</b>并排显示：出现黄色「看板多出的列」＝ 流程长出来了，还没被确认。超过 7 天未更新 → 徽标变黄，提示 PM 补发。</p>
    </div>
  </section>

  <!-- 9b value stream -->
  <section class="slide airy">
    <div class="head">
      <div class="kicker"><span class="dot"></span>VALUE STREAM</div>
      <h2>看板是 VSM：流程与产出都不是固定的</h2>
      <p class="lead" style="font-size:18px">岗位的任务<b>不必然是编程任务</b>，看板也不是固定的列。</p>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card k"><span class="bar"></span>
          <div class="num">PROJECT KIND</div><h3>项目类型</h3>
          <p>软件交付 / 销售机会 / 合同管理 / 客诉处理 / 物流投递 / 其他。</p>
          <p>类型决定<b>产出长什么样</b>，不是所有卡都要代码。</p>
        </div>
        <div class="card g"><span class="bar"></span>
          <div class="num">WORKFACE</div><h3>工作面</h3>
          <p>仓库只是工作面之一：文档空间、CRM、表单、看板本身。</p>
          <p>非软件岗位<b>不需要 Gitea 身份</b>，有 KanEO 身份就能接单。</p>
        </div>
        <div class="card n"><span class="bar"></span>
          <div class="num">DELIVERABLE</div><h3>产出类型是开放的</h3>
          <p>卡片用 <b>kind:&lt;类型&gt;</b> 标签声明产出：doc、quote、contract、complaint…</p>
          <p>权威载体只有一个，但<b>不限于代码</b>。</p>
        </div>
      </div>
      <p class="small">⚠ 看板自己的自动化会很快把卡带走（实测：进入 ready 后约 20 秒被搬到 in-progress）——监听列与轮询间隔要跟看板流程的速度匹配；没被接住时，再推一次。</p>
    </div>
  </section>

  <!-- 10 worker claim -->
`

const updated = source.slice(0, start) + replacement + source.slice(source.indexOf('  <!-- 10 worker claim -->') + '  <!-- 10 worker claim -->'.length)
writeFileSync(path, updated, 'utf8')
console.log('patched, bytes', updated.length)
