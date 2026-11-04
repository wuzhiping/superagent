import { readFileSync, writeFileSync } from 'node:fs'

const path = 'SOP.html'
const source = readFileSync(path, 'utf8')
const marker = '  <!-- 6 archive fields -->'
if (!source.includes(marker)) { console.log('marker missing'); process.exit(1) }

const slide = `  <!-- 5b three settings -->
  <section class="slide airy">
    <div class="head">
      <div class="kicker"><span class="dot"></span>ONBOARDING · 三件事</div>
      <h2>上手只要三步：贴钥匙、登记岗位、发布宪章</h2>
      <p class="lead" style="font-size:18px">看板自己说的，面板不重复设置。</p>
    </div>
    <div class="content">
      <div class="grid g3 fill">
        <div class="card k"><span class="bar"></span>
          <div class="num">STEP 01</div><h3>贴一把 API key</h3>
          <p>设置 → 来源 → KanEO：服务器地址 + <b>API key</b> → 保存。</p>
          <p>面板随即读出工作区、项目与<b>看板真实的列</b>。</p>
        </div>
        <div class="card g"><span class="bar"></span>
          <div class="num">STEP 02</div><h3>登记岗位</h3>
          <p>项目 id + 每个岗位的 <b>KanEO 用户 id</b> + 领哪些列 + 并发上限。</p>
          <p>Gitea / ntfy 身份可留空——不是编程任务就不需要。</p>
        </div>
        <div class="card n"><span class="bar"></span>
          <div class="num">STEP 03</div><h3>发布宪章</h3>
          <p>设置 → 项目与岗位 → 宪章：写当期流程与交付标准 → <b>发布</b>。</p>
          <p>版本号 +1、记发布者、旧版进历史；工单钉在开工那版。</p>
        </div>
      </div>
      <p class="small"><b>KanEO 是唯一的直接来源</b>：Gitea / ntfy 的事件先入库成看板上的卡（落在 to-do），PM 指派并移进监听列后，才成为职责——之后与 KanEO 原生的卡走完全一样的流程。</p>
    </div>
  </section>

`

writeFileSync(path, source.replace(marker, slide + marker), 'utf8')
console.log('slide inserted')
