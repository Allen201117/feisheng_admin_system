// 平台工厂列表：总览三分类、筛选、搜索、排序（纯函数，不碰 wx）
const { filterListByKeyword } = require('../../../utils/list-search')
const { toTimestamp } = require('../../../utils/org-billing.logic')

const ORG_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'normal', label: '正常' },
  { key: 'trial', label: '试用中' },
  { key: 'disabled', label: '停用' }
]

const SORT_MODES = {
  due: '快到期的在前',
  created: '新建的在前'
}

const ORG_SEARCH_FIELDS = [
  'org_name',
  'factory_code',
  'contact_name',
  'contact_phone',
  'bucket_label',
  'plan_name_view',
  'expiry_text'
]

const BUCKET_BADGE = {
  normal: 'badge-green',
  trial: 'badge-blue',
  disabled: 'badge-slate'
}

const TONE_TEXT_CLASS = {
  ok: 'text-secondary',
  warn: 'text-amber',
  over: 'text-red',
  muted: 'text-secondary'
}

function buildOverviewCards(orgs, activeFilter) {
  const counts = { all: 0, normal: 0, trial: 0, disabled: 0 }
  for (const org of orgs || []) {
    counts.all += 1
    if (counts[org.bucket] !== undefined) counts[org.bucket] += 1
  }
  return ORG_FILTERS.map(item => ({
    key: item.key,
    label: item.label,
    value: counts[item.key],
    active: item.key === activeFilter
  }))
}

// 再点一次已选中的分类 = 回到全部
function nextFilter(current, tapped) {
  if (!tapped || tapped === current) return 'all'
  return ORG_FILTERS.some(item => item.key === tapped) ? tapped : 'all'
}

// 快到期排序：已过期最前 → 剩余天数少的 → 没有到期概念的（未开通/永久）→ 停用的最后
function urgencyRank(org) {
  if (org.bucket === 'disabled') return 3e6
  if (typeof org.days_remaining === 'number') return org.days_remaining
  return 2e6
}

function sortOrgs(list, mode) {
  const rows = (list || []).slice()
  if (mode === 'created') {
    rows.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))
    return rows
  }
  rows.sort((a, b) => {
    const diff = urgencyRank(a) - urgencyRank(b)
    if (diff !== 0) return diff
    return String(a.org_name || '').localeCompare(String(b.org_name || ''), 'zh-Hans-CN')
  })
  return rows
}

function filterOrgs(list, filter, keyword) {
  const byBucket = (list || []).filter(org => !filter || filter === 'all' || org.bucket === filter)
  return filterListByKeyword(byBucket, keyword, ORG_SEARCH_FIELDS)
}

function decorateOrgRow(org) {
  return Object.assign({}, org, {
    bucket_badge_class: BUCKET_BADGE[org.bucket] || 'badge-slate',
    expiry_text_class: TONE_TEXT_CLASS[org.expiry_tone] || 'text-secondary',
    contact_text: [org.contact_name, org.contact_phone].filter(Boolean).join(' · ') || '未填联系人'
  })
}

function buildOrgRows(list, options) {
  const opts = options || {}
  return sortOrgs(filterOrgs(list, opts.filter, opts.keyword), opts.sort).map(decorateOrgRow)
}

module.exports = {
  ORG_FILTERS,
  SORT_MODES,
  ORG_SEARCH_FIELDS,
  buildOverviewCards,
  nextFilter,
  urgencyRank,
  sortOrgs,
  filterOrgs,
  decorateOrgRow,
  buildOrgRows
}
