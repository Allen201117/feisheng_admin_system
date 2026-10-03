// 内存版 wx-server-sdk 数据库替身：只实现 platform / billing 云函数用到的那部分接口，
// 用来真跑云函数入口，验证幂等、并发重复、写到一半失败后重试这些纯函数测不到的路径。
// 与真实云开发对齐的几点：查询不存在的集合会抛 -502005；doc().update 不存在的记录不抛错、updated=0；
// 查询默认 limit 20。写入（add/set/update）会顺带建集合——线上集合都已存在，这里放宽。
const Module = require('node:module')
const path = require('node:path')

const SERVER_DATE = Symbol('serverDate')

function createFakeDb(seed) {
  const store = new Map()
  let autoId = 0
  const failures = []
  const writes = []

  function table(name) {
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)
  }

  for (const [name, docs] of Object.entries(seed || {})) {
    for (const doc of docs) table(name).set(doc._id, clone(doc))
  }

  function clone(value) {
    if (value instanceof Date) return new Date(value.getTime())
    if (Array.isArray(value)) return value.map(clone)
    if (value && typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = clone(v)
      return out
    }
    return value
  }

  function materialize(data) {
    const out = {}
    for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_DATE ? new Date() : clone(v)
    return out
  }

  // 注入故障：命中 (collection, op) 的下 n 次写操作抛错
  function failNext(collection, op, times) {
    failures.push({ collection, op, left: times || 1 })
  }

  function maybeFail(collection, op) {
    const rule = failures.find(item => item.collection === collection && item.op === op && item.left > 0)
    if (rule) {
      rule.left -= 1
      throw new Error(`injected failure: ${collection}.${op}`)
    }
  }

  function matches(doc, where) {
    for (const [key, cond] of Object.entries(where || {})) {
      const value = doc[key]
      if (cond && cond.__op === 'in') { if (!cond.arr.includes(value)) return false; continue }
      if (cond && cond.__op === 'neq') { if (value === cond.v) return false; continue }
      if (cond && cond.__op === 'exists') { if ((value !== undefined) !== cond.b) return false; continue }
      if (value !== cond) return false
    }
    return true
  }

  function query(name, state) {
    const s = Object.assign({ where: {}, order: null, skip: 0, limit: 20 }, state)
    function rows() {
      if (!store.has(name)) {
        const err = new Error('DATABASE_COLLECTION_NOT_EXIST: ' + name)
        err.errCode = -502005
        throw err
      }
      let list = Array.from(table(name).values()).filter(doc => matches(doc, s.where))
      if (s.order) {
        const { field, dir } = s.order
        list.sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field]
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field]
          if (av === bv) return 0
          return (av > bv ? 1 : -1) * (dir === 'desc' ? -1 : 1)
        })
      }
      return list
    }
    return {
      where: w => query(name, Object.assign({}, s, { where: w })),
      orderBy: (field, dir) => query(name, Object.assign({}, s, { order: { field, dir } })),
      skip: n => query(name, Object.assign({}, s, { skip: n })),
      limit: n => query(name, Object.assign({}, s, { limit: n })),
      get: async () => ({ data: rows().slice(s.skip, s.skip + s.limit).map(clone) }),
      count: async () => ({ total: rows().length })
    }
  }

  const db = {
    command: {
      in: arr => ({ __op: 'in', arr }),
      neq: v => ({ __op: 'neq', v }),
      exists: b => ({ __op: 'exists', b })
    },
    serverDate: () => SERVER_DATE,
    createCollection: async (name) => {
      writes.push({ collection: name, op: 'createCollection' })
      if (store.has(name)) {
        const err = new Error('DATABASE_COLLECTION_ALREADY_EXIST')
        err.errCode = -502005
        throw err
      }
      table(name)
    },
    collection(name) {
      const base = query(name, {})
      return Object.assign({}, base, {
        add: async ({ data }) => {
          writes.push({ collection: name, op: 'add' })
          maybeFail(name, 'add')
          const id = data._id || ('auto_' + (++autoId))
          if (table(name).has(id)) throw new Error('duplicate key _id: ' + id)
          table(name).set(id, Object.assign(materialize(data), { _id: id }))
          return { _id: id }
        },
        doc(id) {
          return {
            get: async () => {
              if (!store.has(name)) {
                const err = new Error('DATABASE_COLLECTION_NOT_EXIST: ' + name)
                err.errCode = -502005
                throw err
              }
              if (!table(name).has(id)) throw new Error('document.get:fail document with _id ' + id + ' does not exist')
              return { data: clone(table(name).get(id)) }
            },
            set: async ({ data }) => {
              writes.push({ collection: name, op: 'set', id })
              maybeFail(name, 'set')
              table(name).set(id, Object.assign(materialize(data), { _id: id }))
            },
            update: async ({ data }) => {
              writes.push({ collection: name, op: 'update', id })
              maybeFail(name, 'update')
              if (!table(name).has(id)) return { stats: { updated: 0 } }
              table(name).set(id, Object.assign(table(name).get(id), materialize(data)))
              return { stats: { updated: 1 } }
            }
          }
        }
      })
    }
  }

  return {
    db,
    failNext,
    writes,
    all: name => Array.from(table(name).values()).map(clone),
    get: (name, id) => (table(name).has(id) ? clone(table(name).get(id)) : null)
  }
}

// 用替身数据库加载云函数入口；每次都重新 require，互不串状态
function loadCloudFunction(fnDir, fake) {
  const entry = path.join(__dirname, '..', '..', 'cloudfunctions', fnDir, 'index.js')
  const fakeSdk = { init() {}, DYNAMIC_CURRENT_ENV: 'test-env', database: () => fake.db }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return fakeSdk
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(entry)]
    return require(entry)
  } finally {
    Module._load = originalLoad
  }
}

// 平台管理员 + 平台组织（auth-guard 要求调用者所属组织 active）
function platformSeed(extra) {
  const base = {
    Organizations: [{ _id: 'org_platform', org_name: '平台', factory_code: 'PLATFORM', status: 'active', platform_role: 'platform_admin' }],
    Users: [{ _id: 'u_admin', org_id: 'org_platform', name: 'Allen', role: 'boss', platform_role: 'platform_admin', status: 'active', session_token: 'tok' }]
  }
  for (const [name, docs] of Object.entries(extra || {})) {
    base[name] = (base[name] || []).concat(docs)
  }
  return base
}

const ADMIN_AUTH = { auth_user_id: 'u_admin', auth_session_token: 'tok' }

module.exports = { createFakeDb, loadCloudFunction, platformSeed, ADMIN_AUTH }
