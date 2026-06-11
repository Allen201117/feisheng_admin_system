function normalizeListSearchKeyword(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

function getByPath(item, path) {
  if (!item || !path) return ''
  return String(path).split('.').reduce((current, key) => {
    if (current === null || current === undefined) return ''
    return current[key]
  }, item)
}

function collectSearchText(item, fields) {
  return (fields || []).map((field) => {
    if (typeof field === 'function') return field(item)
    return getByPath(item, field)
  }).filter(value => value !== null && value !== undefined).join(' ')
}

function filterListByKeyword(list, keyword, fields) {
  const rows = Array.isArray(list) ? list : []
  const normalizedKeyword = normalizeListSearchKeyword(keyword)
  if (!normalizedKeyword) return rows

  return rows.filter((item) => {
    return normalizeListSearchKeyword(collectSearchText(item, fields)).indexOf(normalizedKeyword) >= 0
  })
}

module.exports = {
  normalizeListSearchKeyword,
  filterListByKeyword
}
