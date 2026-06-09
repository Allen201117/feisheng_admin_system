const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('employee profile salary summary follows payroll mode from settings', () => {
  const js = read('miniprogram/pages/employee/profile/profile.js')
  const wxml = read('miniprogram/pages/employee/profile/profile.wxml')
  const cloud = read('cloudfunctions/salary/index.js')

  assert.match(js, /action:\s*'getUserPayrollSalary'/)
  assert.match(wxml, /\{\{salaryPeriodLabel\}\}/)
  assert.match(wxml, /\{\{statisticsTitle\}\}/)
  assert.match(wxml, /payrollMode === 'monthly'/)
  assert.match(wxml, /订单工资明细/)
  assert.match(cloud, /getUserPayrollSalary/)
  assert.match(cloud, /salary_payroll_mode/)
})
