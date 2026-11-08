/**
 * Builds a deck in the SOP.html shell: the same 1280×720 stage, theme, navigation and print rules.
 *
 * The SOP deck is the single source of the shell (CSS, stage markup, navigation script); a deck generator only replaces
 * the title and the badge label and appends its own slides, so every deck stays visually identical.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const START = '<div class="viewport"><div class="stage" id="stage">'

export function deck ({ title, badge }) {
  const shell = readFileSync('SOP.html', 'utf8')
  const prefixEnd = shell.indexOf(START) + START.length
  if (prefixEnd < START.length) throw new Error('SOP.html no longer has the stage marker')
  const prefix = shell.slice(0, prefixEnd).replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
  const lastSection = shell.lastIndexOf('</section>')
  const suffix = shell.slice(lastSection + '</section>'.length).replace(/b\.textContent = '[^']*'/, `b.textContent = '${badge}'`)
  const slides = []
  return {
    slide (name, sectionClass, html) {
      slides.push(`\n  <!-- ${slides.length + 1} ${name} -->\n  <section class="slide${sectionClass ? ` ${sectionClass}` : ''}">\n${html}\n  </section>`)
      return slides.length
    },
    write (file) {
      writeFileSync(file, prefix + slides.join('\n') + '\n\n' + suffix.trimStart(), 'utf8')
      console.log(`${file} written: ${slides.length} slides`)
    },
    get count () { return slides.length },
  }
}

/** A screenshot inside a card, sized to the content area without clipping. */
export const shot = (src, alt, height = 320) =>
  `<div class="card" style="padding:10px;display:flex;align-items:center;justify-content:center;overflow:hidden">` +
  `<img src="${src}" alt="${alt}" style="max-width:100%;max-height:${height}px;border-radius:10px;display:block" /></div>`

/** The cover slide every deck of this family starts with. */
export const cover = ({ kicker, title, ghost, lead, tags, meta }) => `
    <div class="glow"></div><div class="ghost">${ghost}</div>
    <div class="head">
      <div class="kicker"><span class="dot"></span>${kicker}</div>
      <h1>${title}</h1>
      <p class="lead" style="max-width:46em">${lead}</p>
    </div>
    <div class="content">
      <div class="sub" style="margin-top:0;display:flex;gap:10px;flex-wrap:wrap">${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>
      <div class="meta">${meta.map(([label, value]) => `<div>${label}<b>${value}</b></div>`).join('')}</div>
    </div>`
