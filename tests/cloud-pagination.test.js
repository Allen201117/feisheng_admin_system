const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('cloud pagination helpers normalize page size before using database limit', () => {
  const files = [
    'cloudfunctions/worklog/index.js',
    'cloudfunctions/attendance/index.js',
    'cloudfunctions/order/index.js',
    'cloudfunctions/salary/index.js'
  ]

  files.forEach((file) => {
    const source = read(file)
    assert.match(source, /function normalizePageSize\(/, `${file} should define normalizePageSize`)
    assert.match(source, /const pageSize = normalizePageSize\(/, `${file} should normalize pageSize`)
  })
})

test('worklog pagination helper accepts query options for field projection', () => {
  const source = read('cloudfunctions/worklog/index.js')

  assert.match(source, /async function fetchAllDocs\(collectionName, where, options = \{\}\)/)
  assert.match(source, /const field = \w+\.field \|\| null/)
  assert.match(source, /if \(field\) query = query\.field\(field\)/)
})
