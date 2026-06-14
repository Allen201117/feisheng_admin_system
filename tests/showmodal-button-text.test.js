const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 微信 wx.showModal 约束：confirmText / cancelText 最多 4 个字符。
// 超长时 showModal 触发 fail 回调、弹窗根本不显示——表现为「点击没反应」。
// 调试实录：confirmText:'恢复进行中'(5字) 导致老板端「恢复」按钮点了没反应。
// 本测试静态扫描全部小程序 JS，防止这类「超长按钮文案」回归。
function collectJsFiles(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) collectJsFiles(full, acc)
    else if (name.endsWith('.js')) acc.push(full)
  }
  return acc
}

test('wx.showModal confirmText/cancelText 不超过 4 个字符', () => {
  const root = path.join(__dirname, '..', 'miniprogram')
  const files = collectJsFiles(root, [])
  const re = /(confirmText|cancelText):\s*'([^']*)'/g
  const violations = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    let m
    while ((m = re.exec(src)) !== null) {
      const key = m[1]
      const value = m[2]
      const len = [...value].length // 按码点计数
      if (len > 4) {
        violations.push(`${path.relative(root, file)}: ${key}='${value}' (${len}字)`)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    '以下 wx.showModal 按钮文案超过 4 字（微信上限），会导致弹窗不显示：\n' + violations.join('\n')
  )
})
