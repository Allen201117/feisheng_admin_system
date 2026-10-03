// 极简小程序运行时替身：Page / wx / getApp。
// 页面里的 callCloud → wx.cloud.callFunction 直接接到用 fake-cloud 加载的真实云函数入口，
// 返回值经过一次 JSON 往返（与真机一样，Date 变成字符串、undefined 字段消失）。
const path = require('node:path')
const { loadCloudFunction } = require('./fake-cloud')

const MINIPROGRAM_ROOT = path.join(__dirname, '..', '..', 'miniprogram')

function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function setPath(target, keyPath, value) {
  const keys = keyPath.split('.')
  let node = target
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (node[keys[i]] === null || typeof node[keys[i]] !== 'object') node[keys[i]] = {}
    node = node[keys[i]]
  }
  node[keys[keys.length - 1]] = value
}

// 让所有排队的 promise / setImmediate 跑完（云函数入口内部有多层 await）
async function flush() {
  for (let i = 0; i < 60; i += 1) await new Promise(resolve => setImmediate(resolve))
}

function installMiniProgram(options) {
  const opts = options || {}
  const calls = { toasts: [], modals: [], navigateTo: [], reLaunch: [], clipboard: [], cloud: [] }
  const functions = {
    platform: loadCloudFunction('platform', opts.fake),
    billing: loadCloudFunction('billing', opts.fake)
  }
  const storage = {
    factory_user_info: JSON.stringify(opts.user || { _id: 'u_admin', name: 'Allen', session_token: 'tok', platform_role: 'platform_admin' })
  }
  let modalAnswer = opts.modalConfirm === undefined ? true : opts.modalConfirm

  global.wx = {
    getStorageSync: key => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: key => { delete storage[key] },
    showToast: o => calls.toasts.push(o.title),
    showLoading() {},
    hideLoading() {},
    showModal: o => {
      calls.modals.push({ title: o.title, content: o.content, confirmText: o.confirmText })
      const confirm = !!modalAnswer
      Promise.resolve().then(() => o.success && o.success({ confirm, cancel: !confirm }))
    },
    navigateTo: o => calls.navigateTo.push(o.url),
    reLaunch: o => calls.reLaunch.push(o.url),
    stopPullDownRefresh() {},
    setNavigationBarTitle() {},
    setClipboardData: o => {
      calls.clipboard.push(o.data)
      if (o.success) o.success()
    },
    cloud: {
      callFunction: async ({ name, data }) => {
        calls.cloud.push({ name, action: data.action, data: jsonClone(data) })
        const result = await functions[name].main(jsonClone(data), {})
        return { result: jsonClone(result) }
      }
    }
  }
  global.getApp = () => ({ logout() { calls.logout = true }, globalData: {} })

  let captured = null
  global.Page = (config) => { captured = config }

  function loadPage(pagePath) {
    const file = path.join(MINIPROGRAM_ROOT, pagePath + '.js')
    delete require.cache[require.resolve(file)]
    captured = null
    require(file)
    if (!captured) throw new Error('Page() not called in ' + pagePath)
    const page = {}
    for (const [key, value] of Object.entries(captured)) {
      if (key !== 'data') page[key] = value
    }
    page.data = jsonClone(captured.data || {})
    page.setData = function (patch, callback) {
      for (const [key, value] of Object.entries(patch)) setPath(page.data, key, jsonClone(value))
      if (callback) callback.call(page)
    }
    return page
  }

  return {
    calls,
    loadPage,
    setModalAnswer(answer) { modalAnswer = answer },
    cloudActions: () => calls.cloud.map(item => item.name + '.' + item.action)
  }
}

function tap(dataset) {
  return { currentTarget: { dataset: dataset || {} } }
}

function input(value, dataset) {
  return { detail: { value }, currentTarget: { dataset: dataset || {} } }
}

module.exports = { installMiniProgram, flush, tap, input }
