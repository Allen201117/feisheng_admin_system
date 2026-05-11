const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveCloudCallResult,
  shouldRetryCloudCallError,
  buildCloudCallFailureMessage
} = require('../miniprogram/utils/util')

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

test('shouldRetryCloudCallError retries request transport failures', () => {
  assert.equal(
    shouldRetryCloudCallError({ errMsg: 'request:fail timeout' }),
    true
  )
})

test('shouldRetryCloudCallError does not retry cloud function execution failures', () => {
  assert.equal(
    shouldRetryCloudCallError({ errMsg: 'cloud.callFunction:fail Error: errCode: -504002 cloud function execution timeout' }),
    false
  )
})

test('buildCloudCallFailureMessage preserves service errors instead of reporting network error', () => {
  assert.match(
    buildCloudCallFailureMessage({ message: 'cloud.callFunction:fail Error: 操作失败: cannot update _id' }),
    /cannot update _id/
  )
})

test('buildCloudCallFailureMessage labels cloud function timeout as service timeout', () => {
  assert.equal(
    buildCloudCallFailureMessage({ errMsg: 'cloud.callFunction:fail Error: errCode: -504002 cloud function execution timeout' }),
    '服务处理超时，请稍后重试'
  )
})
