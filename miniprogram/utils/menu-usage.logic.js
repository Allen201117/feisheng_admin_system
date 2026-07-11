// 老板首页「经营概览」常用入口排序（可被 node:test 单测，不碰 wx）。
// 口径：按累计点击频次降序；同频次保持入口池默认顺序（稳定排序，不依赖引擎 sort 稳定性）。
// 默认（无任何使用记录）即池的原始顺序，取前 N 个作为置顶快捷入口。

function rankMenuByUsage(pool, usage) {
  const list = Array.isArray(pool) ? pool : []
  const u = usage || {}
  return list
    .map((item, idx) => ({ item, idx, count: Number(u[item.key]) || 0 }))
    .sort((a, b) => (b.count - a.count) || (a.idx - b.idx))
    .map((x) => x.item)
}

// 点击某入口后返回累加了该 key 的新 usage 对象（不可变，便于 setStorage）。
function bumpUsage(usage, key) {
  const u = Object.assign({}, usage || {})
  if (key) u[key] = (Number(u[key]) || 0) + 1
  return u
}

module.exports = { rankMenuByUsage, bumpUsage }
