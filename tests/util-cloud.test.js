const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveCloudCallResult } = require('../miniprogram/utils/util')

test('resolveCloudCallResult returns successful result objects unchanged', () => {
  const result = { code: 0, data: { ok: true } }
  assert.deepEqual(resolveCloudCallResult(result), result)
})

test('resolveCloudCallResult preserves retry business result for attendance page handling', () => {
  const result = { code: -2, msg: '定位不稳定，请重试', data: { retry: true } }
  assert.deepEqual(resolveCloudCallResult(result), result)
})

test('resolveCloudCallResult throws on normal business errors', () => {
  assert.throws(
    () => resolveCloudCallResult({ code: -1, msg: '普通失败' }),
    /普通失败/
  )
})