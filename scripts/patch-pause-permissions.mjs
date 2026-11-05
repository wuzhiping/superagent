/**
 * Pauses the permission gate in the panel: switching between the PM view and a post's view no longer asks the host who
 * this Host's Kanban account is, and the posts and settings pages no longer show the rights banner. The host-side check
 * (`GET capabilities`, `src/app/capabilities.ts`) stays available for whoever re-enables the gate; nothing else gates a
 * seat, so both views keep working for every account.
 *
 *   node scripts/patch-pause-permissions.mjs
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const write = (path, text) => writeFileSync(path, text, 'utf8')
const expect = (ok, label) => { if (!ok) { console.error(`MISS ${label}`); process.exitCode = 1 } }

// ---------------------------------------------------------------- app.tsx
{
  const path = 'src/client/app.tsx'
  let text = read(path)
  expect(text.includes("import type { Capabilities } from '../app/capabilities.ts'"), 'app capabilities type import')
  text = text.replace(/import type \{ Capabilities \} from '\.\.\/app\/capabilities\.ts'\r?\n/, '')
  expect(text.includes("import { CapabilitiesProvider, permissionLines, useCapabilities } from './capabilities.tsx'"), 'app capabilities import')
  text = text.replace(/import \{ CapabilitiesProvider, permissionLines, useCapabilities \} from '\.\/capabilities\.tsx'\r?\n/, '')

  const switchFrom = /\/\*\* The perspective switch: the same deployment read from the PM's seat or from a post's seat\. \*\/\r?\nfunction PerspectiveSwitch\(\) \{[\s\S]*?\r?\n\}\r?\n/
  expect(switchFrom.test(text), 'app PerspectiveSwitch')
  const switchTo = `/** The perspective switch: the same deployment read from the PM's seat or from a post's seat. */
function PerspectiveSwitch() {
  const { t, navigate } = usePanel()
  const { perspective, setPerspective } = usePerspective()
  // Both seats are open to every account: the host still answers \`GET capabilities\`, but nothing asks before a seat is
  // taken (the gate is paused; see TDD/011 §4.7 for how it looked and how to bring it back).
  const choose = (value: Perspective) => {
    if (value === perspective) return
    setPerspective(value)
    navigate(HOME_BY_PERSPECTIVE[value], true)
  }
  return <div className="dt-perspective" role="group" aria-label={t('perspectiveLabel')}>
    {(['pm', 'post'] as const).map(value => <button key={value} type="button" className="dt-perspective-option"
      aria-pressed={perspective === value} onClick={() => choose(value)}>{t(\`perspective.\${value}\`)}</button>)}
  </div>
}
`
  text = text.replace(switchFrom, switchTo)

  expect(text.includes('<CapabilitiesProvider>\n        <Pages route={location.route} openTab={openTab} deploymentForm={deploymentForm} />\n      </CapabilitiesProvider>'), 'app provider wrapper')
  text = text.replace(
    '      <CapabilitiesProvider>\n        <Pages route={location.route} openTab={openTab} deploymentForm={deploymentForm} />\n      </CapabilitiesProvider>\n',
    '      <Pages route={location.route} openTab={openTab} deploymentForm={deploymentForm} />\n')
  write(path, text)
}

// ---------------------------------------------------------------- posts.tsx / settings.tsx
for (const path of ['src/client/posts.tsx', 'src/client/settings.tsx']) {
  let text = read(path)
  expect(text.includes("import { PermissionBanner } from './capabilities.tsx'"), `${path} banner import`)
  text = text.replace(/import \{ PermissionBanner \} from '\.\/capabilities\.tsx'\r?\n/, '')
  expect(text.includes('<PermissionBanner />'), `${path} banner use`)
  text = text.replace(/\s*<PermissionBanner \/>\r?\n/, '\n')
  write(path, text)
}

// ---------------------------------------------------------------- the client half of the gate
unlinkSync('src/client/capabilities.tsx')

// ---------------------------------------------------------------- styles and copy
{
  const path = 'src/client/client.css'
  let text = read(path)
  expect(text.includes('.dt-permission { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }\n'), 'permission style')
  text = text.replace(/.dt-permission \{[^\n]*\n/, '')
  write(path, text)
}
{
  const path = 'src/client/locales.ts'
  let text = read(path)
  const block = /  \/\/ The Kanban account behind this Host and the rights it needs for the PM seat \(RD\.md §4\.1\)\.\r?\n/
  expect(block.test(text), 'permission locale comment')
  text = text.replace(block, '')
  for (const key of ['permissionTitle', 'permissionAccount', 'permissionNoAccount', 'permissionWhy', 'permissionNext',
    'permissionNextAccount', 'permissionHostReason', 'permissionSwitchTitle', 'permissionSwitchConfirm', 'permissionSwitchAnyway']) {
    const entry = new RegExp(`  ${key}: \\[[\\s\\S]*?\\],\\r?\\n`)
    expect(entry.test(text), `locale ${key}`)
    text = text.replace(entry, '')
  }
  write(path, text)
}

console.log('permission gate paused in the panel')
