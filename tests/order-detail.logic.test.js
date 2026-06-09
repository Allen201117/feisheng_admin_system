const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeAssignedUserIds,
  collectAssignedUserIds,
  buildUserNameMap,
  attachAssignedNamesToProcesses,
  findInvalidAssignedUserIdProcesses,
  sortProcessesForDetail
} = require('../cloudfunctions/order/detail.logic')

test('normalizeAssignedUserIds keeps only non-empty string ids', () => {
  assert.deepEqual(normalizeAssignedUserIds(['u1', '', null, 'u2', 3]), ['u1', 'u2'])
  assert.deepEqual(normalizeAssignedUserIds(undefined), [])
  assert.deepEqual(normalizeAssignedUserIds('u1'), [])
})

test('collectAssignedUserIds deduplicates users across processes', () => {
  const result = collectAssignedUserIds([
    { assigned_user_ids: ['u1', 'u2'] },
    { assigned_user_ids: ['u2', 'u3'] },
    { assigned_user_ids: [] },
    { assigned_user_ids: 'u4' }
  ])

  assert.deepEqual(result, ['u1', 'u2', 'u3'])
})

test('attachAssignedNamesToProcesses preserves shape and adds names', () => {
  const userNameMap = buildUserNameMap([
    { _id: 'u1', name: '张三' },
    { _id: 'u2', name: '李四' }
  ])

  const result = attachAssignedNamesToProcesses([
    { _id: 'p1', process_name: '缝制', assigned_user_ids: ['u1', 'u2', 'missing'] },
    { _id: 'p2', process_name: '包装', assigned_user_ids: [] },
    { _id: 'p3', process_name: '锁边' }
  ], userNameMap)

  assert.equal(result[0].assigned_names, '张三、李四')
  assert.deepEqual(result[0].assigned_user_ids, ['u1', 'u2', 'missing'])
  assert.equal(result[1].assigned_names, '未分配')
  assert.deepEqual(result[1].assigned_user_ids, [])
  assert.equal(result[2].assigned_names, '未分配')
  assert.deepEqual(result[2].assigned_user_ids, [])
})

test('findInvalidAssignedUserIdProcesses reports non-array assigned values', () => {
  const result = findInvalidAssignedUserIdProcesses([
    { _id: 'p1', process_name: '正常', assigned_user_ids: ['u1'] },
    { _id: 'p2', process_name: '字符串', assigned_user_ids: 'u2' },
    { _id: 'p3', process_name: '对象', assigned_user_ids: { id: 'u3' } },
    { _id: 'p4', process_name: '缺失' }
  ])

  assert.deepEqual(result, [
    { _id: 'p2', process_name: '字符串', assigned_user_ids_type: '[object String]' },
    { _id: 'p3', process_name: '对象', assigned_user_ids_type: '[object Object]' }
  ])
})

test('sortProcessesForDetail prefers copied process sort index over write time', () => {
  const result = sortProcessesForDetail([
    { _id: 'p3', process_name: '后写先排', process_sort_index: 2, created_at: 100 },
    { _id: 'p1', process_name: '源第一道', process_sort_index: 0, created_at: 300 },
    { _id: 'p2', process_name: '源第二道', process_sort_index: 1, created_at: 200 }
  ])

  assert.deepEqual(result.map(item => item._id), ['p1', 'p2', 'p3'])
})

test('sortProcessesForDetail keeps legacy time ordering when sort index is absent', () => {
  const result = sortProcessesForDetail([
    { _id: 'p3', created_at: 300 },
    { _id: 'p1', created_at: 100 },
    { _id: 'p2', created_at: 200 }
  ])

  assert.deepEqual(result.map(item => item._id), ['p1', 'p2', 'p3'])
})
