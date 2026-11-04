import { readFileSync, writeFileSync } from 'node:fs'

const path = 'SOP.html'
const source = readFileSync(path, 'utf8')
const from = source.indexOf('  <!-- 6 archive fields -->')
const to = source.indexOf('  <!-- 7 posts page -->')
if (from < 0 || to < 0 || to <= from) { console.log('markers missing'); process.exit(1) }

const slide = `  <!-- 6 archive fields -->
  <section class="slide airy">
    <div class="head">
      <div class="kicker"><span class="dot"></span>REGISTER</div>
      <h2>面板里只登记三件事</h2>
      <p class="lead" style="font-size:18px">设置 → 项目与岗位 → 保存。档案里不放密码；保存带版本号校验，别人同时改过会拒绝覆盖。</p>
    </div>
    <div class="content">
      <table class="tight">
        <tr><th>字段</th><th>含义</th><th>例子</th></tr>
        <tr><td>项目 id / 名称 / slug</td><td>KanEO 项目标识与看板 slug</td><td>dgctny8ibgpn72ei2j8qj2hc · FDEP · FDE</td></tr>
        <tr><td><b>宪章</b></td><td>当期怎么做事：流程、职责、交付标准；写完点「发布」</td><td>version: 2 · publishedBy: pm-fdep</td></tr>
        <tr><td>主题集</td><td>该项目订阅的 ntfy topic</td><td>pub_fdep_pm</td></tr>
        <tr><td>岗位 id / 名称 / 角色</td><td>岗位标识与 PM / Worker</td><td>w1-fdep · SuperAgent Worker 1 (FDEP)</td></tr>
        <tr><td>KanEO 用户 id</td><td><b>决定它领得到哪张卡</b></td><td>bsFdwgQXqZpYKvD5E2emqQ5TQ81eJ3zG</td></tr>
        <tr><td>监听列</td><td>该岗位领哪些列的卡（slug）</td><td>ready</td></tr>
        <tr><td>Gitea 账号 / ntfy sender / 实例</td><td>代码与消息身份、跑在哪台机器（都可留空）</td><td>sa-w1-fdep · #sa-w1-fdep · web</td></tr>
        <tr><td>并发上限 WIP</td><td>同时在飞的职责数上限</td><td>3</td></tr>
      </table>
      <p class="small"><b>不在这里设的</b>：看板的列（从服务器读）、仓库集（由那张卡自己说：repo:owner/name）、产出类型（由 kind: 标签说）、项目类型。</p>
    </div>
  </section>

`

writeFileSync(path, source.slice(0, from) + slide + source.slice(to), 'utf8')
console.log('archive-fields slide rewritten')
