/**
 * 时区迁移脚本 - 检查并修复因服务器时区非UTC+8导致的历史数据日期偏差
 * 
 * 使用场景：
 *   在 init 云函数中调用: { action: 'migrate_timezone' }
 * 
 * 影响的集合与字段：
 *   - WorkLogs.date (YYYY-MM-DD字符串) — 对比 created_at 时间戳判断是否偏差
 *   - Attendances.date (YYYY-MM-DD字符串) — 同上
 * 
 * 策略：
 *   只修复能确定偏移的记录（created_at 存在的情况下，根据 UTC+8 重算 date 字段）
 *   dry_run=true 时只统计不修改
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

function pad2(v) { return String(v).padStart(2, '0') }

function tsToBeijingDateStr(ts) {
  if (!ts) return null
  var ms = typeof ts === 'number' ? ts
    : ts instanceof Date ? ts.getTime()
    : ts.$date ? new Date(ts.$date).getTime()
    : ts.seconds ? parseInt(ts.seconds, 10) * 1000
    : new Date(ts).getTime()
  if (!ms || isNaN(ms)) return null
  var d = new Date(ms + BEIJING_OFFSET_MS)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

async function fetchAll(db, collectionName, where, field) {
  var all = []
  var batchLen = 0
  do {
    var query = db.collection(collectionName).where(where)
    if (field) query = query.field(field)
    var res = await query.skip(all.length).limit(100).get()
    batchLen = (res.data || []).length
    all = all.concat(res.data || [])
  } while (batchLen === 100)
  return all
}

async function migrateTimezoneData(db, options) {
  var dryRun = (options && options.dry_run !== false) ? true : false
  var results = {
    dry_run: dryRun,
    worklogs: { total: 0, mismatched: 0, fixed: 0, errors: 0 },
    attendances: { total: 0, mismatched: 0, fixed: 0, errors: 0 },
    details: []
  }

  // 1. 检查 WorkLogs
  var logs = await fetchAll(db, 'WorkLogs', {}, { _id: true, date: true, created_at: true })
  results.worklogs.total = logs.length

  for (var i = 0; i < logs.length; i++) {
    var log = logs[i]
    if (!log.created_at) continue
    var correctDate = tsToBeijingDateStr(log.created_at)
    if (!correctDate) continue
    if (log.date !== correctDate) {
      results.worklogs.mismatched++
      if (!dryRun) {
        try {
          await db.collection('WorkLogs').doc(log._id).update({
            data: { date: correctDate, _migrated_from_date: log.date }
          })
          results.worklogs.fixed++
        } catch (e) {
          results.worklogs.errors++
        }
      }
      if (results.details.length < 20) {
        results.details.push({
          collection: 'WorkLogs',
          id: log._id,
          old_date: log.date,
          correct_date: correctDate
        })
      }
    }
  }

  // 2. 检查 Attendances
  var atts = await fetchAll(db, 'Attendances', {}, { _id: true, date: true, clock_in_time: true })
  results.attendances.total = atts.length

  for (var j = 0; j < atts.length; j++) {
    var att = atts[j]
    if (!att.clock_in_time) continue
    var correctDate2 = tsToBeijingDateStr(att.clock_in_time)
    if (!correctDate2) continue
    if (att.date !== correctDate2) {
      results.attendances.mismatched++
      if (!dryRun) {
        try {
          await db.collection('Attendances').doc(att._id).update({
            data: { date: correctDate2, _migrated_from_date: att.date }
          })
          results.attendances.fixed++
        } catch (e) {
          results.attendances.errors++
        }
      }
      if (results.details.length < 20) {
        results.details.push({
          collection: 'Attendances',
          id: att._id,
          old_date: att.date,
          correct_date: correctDate2
        })
      }
    }
  }

  return results
}

module.exports = { migrateTimezoneData }
