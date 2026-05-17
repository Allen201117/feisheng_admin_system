const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function listFiles(relativeDir, predicate) {
  const dir = path.join(root, relativeDir)
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      result.push(...listFiles(entryPath, predicate))
    } else if (!predicate || predicate(entryPath)) {
      result.push(entryPath)
    }
  }
  return result
}

function getCssVariable(source, name) {
  const match = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(source)
  return match ? match[1] : ''
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ]
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(foreground, background) {
  const fg = luminance(foreground)
  const bg = luminance(background)
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

test('global WXSS exposes Apple-style design tokens and tactile utilities', () => {
  const source = read('miniprogram/app.wxss')

  for (const token of [
    '--color-bg',
    '--color-card',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-primary',
    '--radius-lg',
    '--shadow-card'
  ]) {
    assert.match(source, new RegExp(`${token}\\s*:`), `missing ${token}`)
  }

  assert.match(source, /\.tap-card-hover\s*\{[^}]*transform:\s*scale\(0\.98\)/s)
  assert.match(source, /\.tap-button-hover\s*\{[^}]*transform:\s*scale\(0\.97\)/s)
  assert.match(source, /\.skeleton-card\b/)
  assert.match(source, /\.bottom-action-bar\b/)
})

test('global neutral text tokens stay readable on white cards', () => {
  const source = read('miniprogram/app.wxss')
  const primary = getCssVariable(source, '--text-primary')

  assert.equal(getCssVariable(source, '--text-secondary'), primary)
  assert.equal(getCssVariable(source, '--text-tertiary'), primary)
  assert.ok(contrastRatio(getCssVariable(source, '--text-secondary'), '#FFFFFF') >= 7)
  assert.ok(contrastRatio(getCssVariable(source, '--text-tertiary'), '#FFFFFF') >= 7)
  assert.ok(contrastRatio(getCssVariable(source, '--text-placeholder'), '#FFFFFF') >= 7)
})

test('page styles do not use low-contrast hardcoded gray text colors', () => {
  const files = [
    'miniprogram/app.wxss',
    ...listFiles('miniprogram/pages', (name) => name.endsWith('.wxss') || name.endsWith('.wxml'))
  ]
  const lowContrastGrayText = /color:\s*#(?:475467|667085|6B7280|6E6E73|8A8F98|98A2B3|A0A4AC|AEAEB3|B0B3BA|C7C7CC)\b/i

  for (const file of files) {
    assert.doesNotMatch(read(file), lowContrastGrayText, `${file} uses low-contrast gray text`)
  }
})

test('global WXSS avoids template-admin rails and dark hero shells', () => {
  const source = read('miniprogram/app.wxss')

  assert.doesNotMatch(source, /--hero-(boss|employee|qc)\s*:\s*linear-gradient/)
  assert.doesNotMatch(source, /border-left:\s*[56]rpx\s+solid/)
  assert.match(source, /\.btn-primary\s*\{[^}]*background:\s*var\(--blue-500\)[^}]*box-shadow:\s*var\(--shadow-blue\)/s)
  assert.match(source, /\.filter-chips\s*\{[^}]*background:\s*var\(--surface-strong\)/s)
})

test('global WXSS gives Apple grouped surfaces product polish', () => {
  const source = read('miniprogram/app.wxss')

  assert.match(source, /--bg-card-soft:\s*#FBFCFE/)
  assert.match(source, /--surface-strong:\s*#EEF2F7/)
  assert.match(source, /--hairline:\s*rgba\(210,216,225,0\.92\)/)
  assert.match(source, /--shadow-card:\s*0 10rpx 30rpx rgba\(15,23,42,0\.07\)/)
  assert.match(source, /\.card\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#FFFFFF 0%,\s*var\(--bg-card-soft\) 100%\)[^}]*box-shadow:\s*var\(--shadow-card\)/s)
  assert.match(source, /\.hero\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#FFFFFF 0%,\s*var\(--bg-card-soft\) 100%\)[^}]*box-shadow:\s*var\(--shadow-elevated\)/s)
  assert.match(source, /\.quick-item\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#FFFFFF 0%,\s*var\(--bg-card-soft\) 100%\)[^}]*box-shadow:\s*var\(--shadow-card\)/s)
  assert.match(source, /\.quick-item-icon\.slate\s*\{\s*background:\s*var\(--surface-strong\);?\s*\}/)
})

test('priority pages wire WeChat hover-class feedback on tappable elements', () => {
  const pages = [
    'miniprogram/pages/employee/home/home.wxml',
    'miniprogram/pages/employee/worklog/worklog.wxml',
    'miniprogram/pages/qc/home/home.wxml',
    'miniprogram/pages/qc/inspect/inspect.wxml',
    'miniprogram/pages/boss/home/home.wxml',
    'miniprogram/pages/boss/data-center/data-center.wxml',
    'miniprogram/pages/boss/settings/settings.wxml',
    'miniprogram/pages/boss/attendance/attendance.wxml'
  ]

  for (const file of pages) {
    const source = read(file)
    assert.match(source, /hover-class="tap-(card|button|row|chip)-hover"/, `${file} has no tactile hover-class`)
  }
})

test('list empty states include a recovery action on priority pages', () => {
  const pages = [
    'miniprogram/pages/employee/worklog/worklog.wxml',
    'miniprogram/pages/qc/home/home.wxml',
    'miniprogram/pages/boss/data-center/data-center.wxml',
    'miniprogram/pages/boss/attendance/attendance.wxml'
  ]

  for (const file of pages) {
    const source = read(file)
    assert.match(source, /class="[^"]*\bempty-action\b/, `${file} empty state lacks an action`)
  }
})

test('screenshot-critical pages use compact grouped action layouts', () => {
  const orderDetail = read('miniprogram/pages/boss/order-detail/order-detail.wxml')
  const employees = read('miniprogram/pages/boss/employees/employees.wxml')
  const worklog = read('miniprogram/pages/boss/worklog-manage/worklog-manage.wxml')

  assert.match(orderDetail, /\border-action-panel\b/)
  assert.match(orderDetail, /\bprocess-action-row\b/)
  assert.doesNotMatch(orderDetail, /一键清空报工记录/)

  assert.match(employees, /\bemployee-add-btn\b/)
  assert.match(employees, /\bemployee-action\b/)
  assert.doesNotMatch(employees, /<button class="btn-primary"[^>]*goAddEmployee/)

  assert.match(worklog, /\bworklog-progress-card\b/)
  assert.match(worklog, /\bworklog-log-actions\b/)
  assert.doesNotMatch(worklog, /btn-primary btn-block"[^>]*openAddWorkLog/)
})

test('login keeps the primary action reachable without scrolling', () => {
  const wxml = read('miniprogram/pages/login/login.wxml')
  const wxss = read('miniprogram/pages/login/login.wxss')
  const json = read('miniprogram/pages/login/login.json')

  assert.match(wxml, /\blogin-bottom-bar\b/)
  assert.match(wxml, /\blogin-primary-btn\b/)
  assert.doesNotMatch(wxml, /\bhero\s+hero-/)
  assert.doesNotMatch(wxml, /btn-primary btn-block btn-lg/)
  assert.match(wxss, /\.login-bottom-bar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/s)
  assert.match(json, /"navigationBarBackgroundColor":\s*"#F5F5F7"/)
  assert.match(json, /"navigationBarTextStyle":\s*"black"/)
})

test('modal sheets stay above their blocking overlay', () => {
  const source = read('miniprogram/app.wxss')

  assert.match(source, /\.modal-overlay\s*\{[^}]*z-index:\s*1000/s)
  assert.match(source, /\.modal-sheet\s*\{[^}]*position:\s*fixed/s)
  assert.match(source, /\.modal-sheet\s*\{[^}]*z-index:\s*1001/s)
})

test('login consent starts unchecked for new users and remembers manual choice', () => {
  const source = read('miniprogram/pages/login/login.js')

  assert.match(source, /consentChecked:\s*false/)
  assert.match(source, /rememberedConsent\s*=\s*hasLocalCurrentConsent\(\)/)
  assert.match(source, /consentChecked:\s*rememberedConsent/)
  assert.match(source, /consentChecked:\s*localConsent/)
  assert.match(source, /if\s*\(checked\)\s*\{\s*markConsentAccepted\(\)/)
  assert.match(source, /else\s*\{\s*clearConsentAccepted\(\)/)
  assert.doesNotMatch(source, /consentChecked:\s*hasConsent\s*\|\|\s*localConsent/)
  assert.doesNotMatch(source, /persistConsentAgreement\(\{\s*silent:\s*true,\s*force:\s*true\s*\}\)/)
})

test('frontend audit has no dark navigation or thick left rails', () => {
  for (const file of listFiles('miniprogram/pages', (name) => name.endsWith('.json'))) {
    const source = read(file)
    assert.doesNotMatch(source, /"navigationBarBackgroundColor":\s*"#2f4761"/, `${file} still uses dark navigation`)
    assert.doesNotMatch(source, /"navigationBarTextStyle":\s*"white"/, `${file} still uses white navigation text`)
  }

  const files = [
    'miniprogram/app.wxss',
    ...listFiles('miniprogram/pages', (name) => name.endsWith('.wxss') || name.endsWith('.wxml'))
  ]
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /border-left:\s*[4-9]rpx\s+solid/, `${file} still uses a thick color rail`)
  }
})
