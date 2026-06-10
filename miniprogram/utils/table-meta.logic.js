// 报表表格列元数据（纯函数，无 wx 依赖，node:test 可测）。
// 解决两类问题：①每列宽度按「该列最长内容」统一计算，保证所有行同列等宽、行列严格对齐；
// ②数字列右对齐、文本列居中、首列左对齐；③表头含「工价/单价」的列标记 isPrice，前端用绿色强调展示。

// CJK 等全角字符按 2 个单位宽，半角按 1 个单位
function visualLength(value) {
  var str = value === null || value === undefined ? '' : String(value)
  var len = 0
  for (var i = 0; i < str.length; i++) {
    len += str.charCodeAt(i) > 0x2e80 ? 2 : 1
  }
  return len
}

function isNumericLike(value) {
  if (value === null || value === undefined) return false
  var str = String(value).trim()
  if (str === '' || str === '—' || str === '-') return false
  return /^-?[¥￥]?\d+(\.\d+)?%?$/.test(str)
}

var PRICE_HEADER_RE = /工价|单价/

/**
 * @param {string[]} headers 表头
 * @param {Array<Array>} rows 数据行（可含合计行）
 * @param {Object} [options] { minWidth=150, maxWidth=460, unitWidth=13, padding=40 } 单位 rpx
 * @returns {Array<{width:number, align:'left'|'center'|'right', isPrice:boolean}>}
 */
function buildTableColumnMeta(headers, rows, options) {
  var opts = options || {}
  var minWidth = opts.minWidth || 150
  var maxWidth = opts.maxWidth || 460
  var unitWidth = opts.unitWidth || 13
  var padding = opts.padding || 40

  var headerList = headers || []
  var rowList = rows || []

  return headerList.map(function(header, colIdx) {
    var maxLen = visualLength(header)
    var numericCount = 0
    var nonEmptyCount = 0

    rowList.forEach(function(row) {
      if (!row) return
      var cell = row[colIdx]
      var len = visualLength(cell)
      if (len > maxLen) maxLen = len
      var str = cell === null || cell === undefined ? '' : String(cell).trim()
      if (str !== '' && str !== '—' && str !== '-') {
        nonEmptyCount++
        if (isNumericLike(cell)) numericCount++
      }
    })

    var width = Math.min(Math.max(maxLen * unitWidth + padding, minWidth), maxWidth)
    var align = 'center'
    if (colIdx === 0) {
      align = 'left'
    } else if (nonEmptyCount > 0 && numericCount === nonEmptyCount) {
      align = 'right'
    }

    return {
      width: width,
      align: align,
      isPrice: PRICE_HEADER_RE.test(String(header || ''))
    }
  })
}

module.exports = {
  buildTableColumnMeta,
  visualLength,
  isNumericLike
}
