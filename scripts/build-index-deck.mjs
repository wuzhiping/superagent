/**
 * Builds INDEX.html: a one-page reading map for the eight root PDFs (same SOP deck shell).
 * The index is deliberately one page: three paths plus the eight documents.
 */
import { deck } from './lib/deck-shell.mjs'

const i = deck({ title: 'INDEX · 根目录 PDF 阅读地图', badge: 'SuperAgent · INDEX' })

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
          <p class="small">按问题找：环境→ABC · 卡没接→DEF · 卡住→GHI · 复盘/知识→EA · 每天怎么干→SOP · 讲给别人→STORY。</p>
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

i.write('INDEX.html')
