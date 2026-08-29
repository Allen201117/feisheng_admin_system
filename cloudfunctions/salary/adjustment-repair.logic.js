// 奖惩冲正记录体检（CLAUDE.md §2.3）
//
// 背景：deleteAdjustment / updateAdjustment 的「已发薪」判断曾经把「按订单发薪」
// 误当成「按月发薪」（markPaid 给按订单发薪的 SalaryPayments 也写了 month），
// 于是没发薪的奖惩也被走了冲正 —— 原记录留着 + 加一条反向记录，老板看着像没删掉。
// 老板多点几次删除还会叠加多条冲正，净额会被越冲越偏（多扣 / 多奖一份钱）。
//
// 本文件只做「算出该怎么修」，不碰 db。三类问题：
//   1. 未发薪期次的冲正对   → 原记录 + 冲正一起删（有更正记录的把更正扶正保留）
//   2. 孤儿冲正             → 原记录已经没了，这条冲正在凭空加/减钱，删
//   3. 重复冲正             → 同一条奖惩被冲正多次，净额已经偏了
// 已发薪期次的冲正是 §2.3 要求保留的痕迹，一律不动。
// 已发薪期次里的孤儿 / 重复冲正会改变已入账金额，只报不改，列入待人工确认。

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 奖惩金额的正负：奖励加钱、处罚扣钱
function signedAmount(adj) {
  const amount = Number(adj && adj.amount) || 0
  return (adj && adj.type === 'reward') ? amount : -amount
}

// 期次键：和 buildAdjustmentPayLockWhere 同口径 —— 订单奖惩看订单，月度奖惩看月份。
// 按订单发薪的 SalaryPayments 虽然也写了 month，但走 order 分支，不会污染月份键。
function buildScopeKey(record) {
  const r = record || {}
  if (r.order_id) return `order:${r.user_id}:${r.order_id}`
  return `month:${r.user_id}:${r.month}`
}

// 宽口径键：该员工该月只要发过任何一笔薪（按月或按订单）就算数。
// 只给孤儿冲正用 —— 旧的孤儿冲正没有 order_id，认不出它原本属于哪个订单，
// 宁可放过也不能删掉一条可能已经计入实发总额的记录。
function buildLooseKey(record) {
  const r = record || {}
  return `loose:${r.user_id}:${r.month}`
}

function scopeText(record) {
  const r = record || {}
  if (r.order_id) return r.order_name ? `订单「${r.order_name}」` : '按订单'
  return r.month || '未知月份'
}

function amountText(adj) {
  if (!adj) return ''
  return `${adj.type === 'reward' ? '奖励' : '处罚'} ¥${round2(adj.amount)}`
}

function planAdjustmentReversalRepairs({ adjustments, paidScopeKeys, paidLooseKeys } = {}) {
  const list = (adjustments || []).filter(Boolean)
  const paidScopes = new Set(paidScopeKeys || [])
  const paidLoose = new Set(paidLooseKeys || [])

  const byId = {}
  list.forEach(a => { if (a._id) byId[a._id] = a })

  // 按 original_id 归组
  const groupMap = {}
  let reversalCount = 0
  list.forEach(a => {
    if (!a.original_id) return
    if (!a.is_reversal && !a.is_correction) return
    if (!groupMap[a.original_id]) groupMap[a.original_id] = { reversals: [], corrections: [] }
    if (a.is_reversal) {
      groupMap[a.original_id].reversals.push(a)
      reversalCount++
    } else {
      groupMap[a.original_id].corrections.push(a)
    }
  })

  const groups = []
  const manualReview = []
  let keptGroups = 0

  Object.keys(groupMap).forEach(originalId => {
    const g = groupMap[originalId]
    if (g.reversals.length === 0) return // 只有更正没有冲正：形状异常，不猜

    const original = byId[originalId] || null
    const anchor = original || g.reversals[0]
    const isOrphan = !original

    // 孤儿用宽口径（认不出订单归属），有原记录的用精确口径
    const paidHere = isOrphan
      ? paidLoose.has(buildLooseKey(anchor))
      : paidScopes.has(buildScopeKey(original))

    const netBefore = round2(
      (original ? signedAmount(original) : 0) +
      g.reversals.reduce((s, r) => s + signedAmount(r), 0) +
      g.corrections.reduce((s, c) => s + signedAmount(c), 0)
    )
    const netAfter = round2(g.corrections.reduce((s, c) => s + signedAmount(c), 0))

    const row = {
      key: originalId,
      user_id: anchor.user_id || '',
      user_name: anchor.user_name || '',
      scope_text: scopeText(anchor),
      net_before: netBefore,
      net_after: isOrphan ? 0 : netAfter,
      reversal_count: g.reversals.length,
      correction_count: g.corrections.length,
      orphan: isOrphan,
      duplicated: g.reversals.length > 1
    }

    if (paidHere) {
      // 已发薪期次：正常的冲正痕迹按 §2.3 保留；孤儿 / 重复冲正会让明细和实发对不上，
      // 但改了同样对不上，交给老板判断。
      if (isOrphan || g.reversals.length > 1) {
        manualReview.push({
          ...row,
          reason: isOrphan
            ? '原记录已经不在了，这条冲正在凭空加减钱，但该期已发薪、动了会和实发总额对不上'
            : `被冲正了 ${g.reversals.length} 次，多冲的部分已经算进实发总额`
        })
      } else {
        keptGroups++
      }
      return
    }

    // 未发薪：老板当初就是想删 / 想改，把误判留下的这一对（或多条）收干净
    const removeIds = g.reversals.map(r => r._id)
    if (original) removeIds.push(original._id)
    // 有更正记录 = 老板当初是「改金额」，把更正扶正成普通记录留下，净额不变
    const promoteIds = g.corrections.map(c => c._id)

    groups.push({
      ...row,
      remove_ids: removeIds,
      promote_ids: promoteIds,
      original_text: original ? amountText(original) : '（原记录已不存在）',
      note: buildGroupNote({ isOrphan, original, group: g, netBefore, netAfter })
    })
  })

  groups.sort((a, b) => Math.abs(b.net_before - b.net_after) - Math.abs(a.net_before - a.net_after))

  const removeCount = groups.reduce((s, g) => s + g.remove_ids.length, 0)
  const promoteCount = groups.reduce((s, g) => s + g.promote_ids.length, 0)

  return {
    scanned: { adjustments: list.length, reversals: reversalCount },
    groups,
    manual_review: manualReview,
    kept_group_count: keptGroups,
    total_group_count: groups.length,
    total_fix_count: removeCount + promoteCount,
    remove_count: removeCount,
    promote_count: promoteCount
  }
}

function buildGroupNote({ isOrphan, original, group, netBefore, netAfter }) {
  if (isOrphan) {
    return `原记录已删，只剩 ${group.reversals.length} 条冲正在凭空${netBefore > 0 ? '加' : '扣'} ¥${Math.abs(netBefore)}，清掉后归零`
  }
  const parts = [`${amountText(original)} + ${group.reversals.length} 条冲正`]
  if (group.corrections.length > 0) parts.push(`${group.corrections.length} 条更正保留`)
  if (round2(netBefore) !== round2(netAfter)) {
    parts.push(`工资 ¥${netBefore} → ¥${netAfter}`)
  } else {
    parts.push('工资不变')
  }
  return parts.join('，')
}

module.exports = {
  planAdjustmentReversalRepairs,
  buildScopeKey,
  buildLooseKey,
  signedAmount
}
