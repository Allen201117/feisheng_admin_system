const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const projectPath = path.resolve(__dirname, '../..');
const cliPath = process.env.WX_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const devtoolsPort = Number(process.env.WX_DEVTOOLS_PORT || 48909);
const automatorPort = Number(process.env.WX_AUTOMATOR_PORT || 9420);
const launchTimeout = Number(process.env.WX_AUTOMATOR_TIMEOUT || 120000);

let miniProgram;
let firstPagePath;

function resolveAppJsonPath(root) {
  const candidates = [
    path.join(root, 'app.json'),
    path.join(root, 'miniprogram', 'app.json')
  ];

  const appJsonPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!appJsonPath) {
    throw new Error('未找到 app.json 或 miniprogram/app.json，无法确定小程序启动页。');
  }

  return appJsonPath;
}

function readFirstPage(root) {
  const appJsonPath = resolveAppJsonPath(root);
  const appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

  if (!Array.isArray(appConfig.pages) || !appConfig.pages[0]) {
    throw new Error(`${appJsonPath} 中缺少 pages[0]，无法执行 smoke test。`);
  }

  return appConfig.pages[0];
}

function normalizeLaunchPath(pagePath) {
  return pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
}

async function getCurrentPagePath(page) {
  if (!page) {
    return '';
  }

  if (typeof page.path === 'function') {
    return page.path();
  }

  if (typeof page.path === 'string') {
    return page.path;
  }

  if (typeof page.route === 'function') {
    return page.route();
  }

  if (typeof page.route === 'string') {
    return page.route;
  }

  return '';
}

beforeAll(async () => {
  firstPagePath = readFirstPage(projectPath);

  if (!fs.existsSync(cliPath)) {
    throw new Error(`未找到微信开发者工具 CLI: ${cliPath}`);
  }

  miniProgram = await automator.launch({
    projectPath,
    cliPath,
    port: automatorPort,
    args: ['--port', String(devtoolsPort)],
    timeout: launchTimeout
  });
}, launchTimeout + 10000);

afterAll(async () => {
  if (miniProgram) {
    await miniProgram.close();
    miniProgram = null;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}, 30000);

test('loads the first configured mini program page', async () => {
  const page = await miniProgram.reLaunch(normalizeLaunchPath(firstPagePath));
  await page.waitFor(1000);

  const currentPath = await getCurrentPagePath(page);
  console.log(`[smoke] current page path: ${currentPath}`);

  expect(currentPath).toBeTruthy();
  expect(String(currentPath).replace(/^\//, '')).toBe(firstPagePath.replace(/^\//, ''));
}, launchTimeout);
