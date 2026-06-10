const test = require('node:test')
const assert = require('node:assert/strict')

const { buildTableColumnMeta, visualLength, isNumericLike } = require('../miniprogram/utils/table-meta.logic')

test('visualLength counts CJK as 2 units', () => {
  assert.equal(visualLength('abc'), 3)
  assert.equal(visualLength('工价'), 4)
  assert.equal(visualLength('工价(元)'), 8)
  assert.equal(visualLength(null), 0)
  assert.equal(visualLength(12.5), 4)
})

test('isNumericLike accepts numbers/currency/percent, rejects text and dashes', () => {
  assert.equal(isNumericLike(12), true)
  assert.equal(isNumericLike('12.5'), true)
  assert.equal(isNumericLike('¥3.50'), true)
  assert.equal(isNumericLike('95%'), true)
  assert.equal(isNumericLike('张三'), false)
  assert.equal(isNumericLike('—'), false)
  assert.equal(isNumericLike(''), false)
})

test('buildTableColumnMeta widths follow longest content and clamp to bounds', () => {
  const meta = buildTableColumnMeta(
    ['姓名', '报工数量'],
    [['张三', 10], ['这是一个非常非常非常非常非常非常长的工序名称合计', 5]]
  )
  // 第一列按长内容增宽且不超过上限
  assert.ok(meta[0].width > meta[1].width)
  assert.ok(meta[0].width <= 460)
  assert.ok(meta[1].width >= 150)
})

test('buildTableColumnMeta aligns: first col left, numeric right, text center', () => {
  const meta = buildTableColumnMeta(
    ['工序名称', '数量', '备注'],
    [['裁剪', 10, '加急'], ['缝纫', 20, '']]
  )
  assert.equal(meta[0].align, 'left')
  assert.equal(meta[1].align, 'right')
  assert.equal(meta[2].align, 'center')
})

test('buildTableColumnMeta marks 工价/单价 columns as price', () => {
  const meta = buildTableColumnMeta(
    ['员工', '结算单价(元)', '当前工价(元)', '小计薪资(元)'],
    [['张三', 0.5, 0.6, 5]]
  )
  assert.equal(meta[0].isPrice, false)
  assert.equal(meta[1].isPrice, true)
  assert.equal(meta[2].isPrice, true)
  assert.equal(meta[3].isPrice, false)
})

test('buildTableColumnMeta handles empty rows safely', () => {
  const meta = buildTableColumnMeta(['A', 'B'], [])
  assert.equal(meta.length, 2)
  assert.equal(meta[0].align, 'left')
  assert.equal(meta[1].align, 'center')
})
