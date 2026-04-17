const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ordersWxmlPath = path.join(__dirname, '..', 'miniprogram', 'pages', 'boss', 'orders', 'orders.wxml')

test('orders.wxml does not contain malformed input attributes', () => {
  const source = fs.readFileSync(ordersWxmlPath, 'utf8')

  assert.doesNotMatch(source, /placeholder="[^"]* value="\{\{/)
})

test('orders.wxml does not contain broken closing text tags', () => {
  const source = fs.readFileSync(ordersWxmlPath, 'utf8')

  assert.doesNotMatch(source, /\?\/text>/)
})
