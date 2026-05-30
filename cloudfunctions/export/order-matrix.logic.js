// 订单计件核算表（矩阵）纯函数 —— 不依赖 wx / db，可被 node:test 单测
// 口径说明：
//   - 行 = 工序，列 = 员工。默认每个员工一列，单元格 = 报工数量，表头只写员工姓名（参考工厂手写核算表）
//   - 工价显示在工序单元格的括号里，例如「去明线（0.05元）」，取 Processes.current_price
//   - 最右「合计」列 = 该工序所有员工数量合计；最底「合计」行 = 该员工所有工序数量合计
//   - 可选 options.includeAmount=true：每个员工拆「数量 | 金额」两列，金额 = quantity * snapshot_price
//     （与项目计件工资口径一致；passed_qty 不参与）

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// 工价格式化：去掉多余小数，保留原值，如 0.05 -> "0.05"，5 -> "5"
function formatPrice(price) {
  if (price === null || price === undefined || price === '') return null
  const n = Number(price)
  if (!Number.isFinite(n)) return null
  return String(n)
}

function processLabel(name, price, priceInLabel) {
  const baseName = name || '未知工序'
  if (!priceInLabel) return baseName
  const p = formatPrice(price)
  return p === null ? baseName : `${baseName}（${p}元）`
}

/**
 * 构建订单计件核算矩阵
 * @param {Object} input
 * @param {Array} input.logs      WorkLogs：{ user_id, user_name, process_id, process_name, quantity, snapshot_price }
 * @param {Array} input.processes Processes：{ _id, process_name, current_price }（用于排序与工价显示，可选）
 * @param {Object} [input.options]
 * @param {boolean} [input.options.includeRowTotal=true]  最右合计列
 * @param {boolean} [input.options.includeColTotal=true]  最底合计行
 * @param {boolean} [input.options.priceInLabel=true]     工序单元格带工价括号
 * @param {boolean} [input.options.includeAmount=false]   每个员工拆「数量|金额」两列；默认仅数量
 * @returns {{ headers: string[], rows: Array<Array> }}
 */
function buildOrderMatrix(input) {
  const logs = (input && input.logs) || []
  const processes = (input && input.processes) || []
  const opts = (input && input.options) || {}
  const includeRowTotal = opts.includeRowTotal !== false
  const includeColTotal = opts.includeColTotal !== false
  const priceInLabel = opts.priceInLabel !== false
  const includeAmount = opts.includeAmount === true

  // 1) 工序顺序与工价：以 Processes 顺序为准，补上日志里出现但 Processes 已删除的工序
  const procMeta = {} // pid -> { name, price, order }
  processes.forEach((p, idx) => {
    const pid = String(p && p._id)
    procMeta[pid] = {
      name: p.process_name || '未知工序',
      price: p.current_price != null ? p.current_price : null,
      order: idx
    }
  })

  // 2) 收集出现在日志里的工序与员工
  const seenProcOrder = [] // 保持首次出现顺序，作为未在 Processes 中工序的兜底排序
  const employeeMap = {}   // uid -> name（保持首次出现）
  const employeeOrder = []

  logs.forEach(l => {
    const pid = String(l.process_id != null ? l.process_id : ('__noproc__' + (l.process_name || '')))
    if (!(pid in procMeta)) {
      procMeta[pid] = {
        name: l.process_name || '未知工序',
        price: null,
        order: processes.length + seenProcOrder.length
      }
      seenProcOrder.push(pid)
    }
    const uid = String(l.user_id != null ? l.user_id : ('__nouser__' + (l.user_name || '')))
    if (!(uid in employeeMap)) {
      employeeMap[uid] = l.user_name || '未知员工'
      employeeOrder.push(uid)
    }
  })

  // 员工列排序：按姓名本地化排序，姓名相同按首次出现稳定
  const employees = employeeOrder.slice().sort((a, b) => {
    const na = employeeMap[a]
    const nb = employeeMap[b]
    const cmp = String(na).localeCompare(String(nb), 'zh-Hans-CN')
    return cmp !== 0 ? cmp : employeeOrder.indexOf(a) - employeeOrder.indexOf(b)
  })

  // 工序行排序：按 procMeta.order
  const procIds = Object.keys(procMeta)
    .filter(pid => {
      // 只保留有日志的工序（与图1/图2展示一致）
      return logs.some(l => {
        const lpid = String(l.process_id != null ? l.process_id : ('__noproc__' + (l.process_name || '')))
        return lpid === pid
      })
    })
    .sort((a, b) => procMeta[a].order - procMeta[b].order)

  // 3) 聚合 cell[pid][uid] = { qty, amt(raw) }
  const cell = {}
  procIds.forEach(pid => { cell[pid] = {} })
  logs.forEach(l => {
    const pid = String(l.process_id != null ? l.process_id : ('__noproc__' + (l.process_name || '')))
    const uid = String(l.user_id != null ? l.user_id : ('__nouser__' + (l.user_name || '')))
    if (!cell[pid]) return
    if (!cell[pid][uid]) cell[pid][uid] = { qty: 0, amt: 0 }
    const qty = toNum(l.quantity)
    const price = toNum(l.snapshot_price)
    cell[pid][uid].qty += qty
    cell[pid][uid].amt += qty * price
  })

  // 4) 表头（默认每个员工一列，表头只写姓名；includeAmount 时拆数量|金额两列）
  const headers = ['工序名称']
  employees.forEach(uid => {
    if (includeAmount) {
      headers.push(`${employeeMap[uid]} 数量`)
      headers.push(`${employeeMap[uid]} 金额`)
    } else {
      headers.push(employeeMap[uid])
    }
  })
  if (includeRowTotal) {
    if (includeAmount) {
      headers.push('合计 数量')
      headers.push('合计 金额')
    } else {
      headers.push('合计')
    }
  }

  // 5) 数据行 + 列合计累加
  const colQty = {} // uid -> qty
  const colAmt = {} // uid -> amt(raw)
  employees.forEach(uid => { colQty[uid] = 0; colAmt[uid] = 0 })
  let grandQty = 0
  let grandAmt = 0

  const rows = procIds.map(pid => {
    const row = [processLabel(procMeta[pid].name, procMeta[pid].price, priceInLabel)]
    let rowQty = 0
    let rowAmt = 0
    employees.forEach(uid => {
      const c = (cell[pid] && cell[pid][uid]) || { qty: 0, amt: 0 }
      row.push(c.qty)
      if (includeAmount) row.push(round2(c.amt))
      rowQty += c.qty
      rowAmt += c.amt
      colQty[uid] += c.qty
      colAmt[uid] += c.amt
    })
    if (includeRowTotal) {
      row.push(rowQty)
      if (includeAmount) row.push(round2(rowAmt))
    }
    grandQty += rowQty
    grandAmt += rowAmt
    return row
  })

  // 6) 最底合计行
  if (includeColTotal) {
    const totalRow = ['合计']
    employees.forEach(uid => {
      totalRow.push(colQty[uid])
      if (includeAmount) totalRow.push(round2(colAmt[uid]))
    })
    if (includeRowTotal) {
      totalRow.push(grandQty)
      if (includeAmount) totalRow.push(round2(grandAmt))
    }
    rows.push(totalRow)
  }

  return { headers, rows }
}

module.exports = { buildOrderMatrix, processLabel, formatPrice }
