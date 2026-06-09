#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./wx-devtools.config.sh
source "$SCRIPT_DIR/wx-devtools.config.sh"

FAILURES=0

ok() {
  printf '[check] OK: %s\n' "$*"
}

fail_check() {
  printf '[check] FAIL: %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

check_file() {
  local label="$1"
  local file="$2"
  if [ -f "$file" ]; then
    ok "$label exists: $file"
  else
    fail_check "$label missing: $file"
  fi
}

check_dir() {
  local label="$1"
  local dir="$2"
  if [ -d "$dir" ]; then
    ok "$label exists: $dir"
  else
    fail_check "$label missing: $dir"
  fi
}

check_node_package() {
  local package_name="$1"
  if node -e "require.resolve('${package_name}/package.json', { paths: [process.cwd()] })" >/dev/null 2>&1; then
    ok "$package_name is installed"
  else
    fail_check "$package_name is not installed"
  fi
}

printf '[check] Current directory: %s\n' "$(pwd)"
printf '[check] Project root: %s\n' "$PROJECT_ROOT"
printf '[check] WX_CLI: %s\n' "$WX_CLI"
printf '[check] WX_DEVTOOLS: http://%s:%s\n' "$WX_DEVTOOLS_HOST" "$WX_DEVTOOLS_PORT"

check_file "package.json" "$PROJECT_ROOT/package.json"
check_file "project.config.json" "$PROJECT_ROOT/project.config.json"
check_dir "miniprogram/" "$PROJECT_ROOT/miniprogram"
check_dir "cloudfunctions/" "$PROJECT_ROOT/cloudfunctions"

if APP_JSON_PATH="$(detect_app_json)"; then
  ok "app.json exists: $APP_JSON_PATH"
else
  fail_check "app.json or miniprogram/app.json is missing"
fi

if check_wx_cli; then
  ok "微信开发者工具 CLI exists and is executable"
else
  fail_check "微信开发者工具 CLI is unavailable"
fi

if check_devtools_port; then
  ok "微信开发者工具服务端口可访问"
else
  fail_check "微信开发者工具服务端口不可访问"
fi

if command -v node >/dev/null 2>&1; then
  ok "Node.js version: $(node --version)"
else
  fail_check "Node.js is not available"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm version: $(npm --version)"
else
  fail_check "npm is not available"
fi

check_node_package "jest"
check_node_package "miniprogram-automator"

if [ "$FAILURES" -gt 0 ]; then
  printf '[check] Project check failed with %s issue(s).\n' "$FAILURES" >&2
  exit 1
fi

printf '[check] Project check passed.\n'
