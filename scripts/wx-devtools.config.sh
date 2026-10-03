#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
if [ -z "${WX_CLI:-}" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # Windows：开发者工具装在 Program Files 下，命令行入口是 cli.bat
      for _wx_cli in "/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" "/c/Program Files/Tencent/微信web开发者工具/cli.bat"; do
        if [ -f "$_wx_cli" ]; then WX_CLI="$_wx_cli"; break; fi
      done ;;
  esac
fi
WX_CLI="${WX_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
WX_DEVTOOLS_HOST="${WX_DEVTOOLS_HOST:-127.0.0.1}"
WX_DEVTOOLS_PORT="${WX_DEVTOOLS_PORT:-48909}"

wx_info() {
  printf '[wx-devtools] %s\n' "$*"
}

wx_error() {
  printf '[wx-devtools] ERROR: %s\n' "$*" >&2
}

wx_truncate() {
  local limit="${2:-400}"
  printf '%s' "$1" | head -c "$limit"
}

detect_app_json() {
  if [ -f "$PROJECT_ROOT/app.json" ]; then
    printf '%s\n' "$PROJECT_ROOT/app.json"
    return 0
  fi

  if [ -f "$PROJECT_ROOT/miniprogram/app.json" ]; then
    printf '%s\n' "$PROJECT_ROOT/miniprogram/app.json"
    return 0
  fi

  return 1
}

# 传给微信开发者工具 CLI 的路径：Windows 版 cli.bat 要 Windows 写法（C:\...），Mac / Linux 没有 cygpath，原样
wx_native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

check_wx_cli() {
  if [ -x "$WX_CLI" ]; then
    return 0
  fi

  # Windows：cli.bat 在 Git Bash 里 test -x 恒为假，但可以直接执行
  case "$WX_CLI" in
    *.bat|*.BAT|*.cmd|*.CMD)
      if [ -f "$WX_CLI" ]; then return 0; fi ;;
  esac

  if [ -e "$WX_CLI" ]; then
    wx_error "微信开发者工具 CLI 存在但不可执行: $WX_CLI"
  else
    wx_error "未找到微信开发者工具 CLI: $WX_CLI"
  fi

  return 1
}

check_project_root() {
  local failed=0

  if [ ! -d "$PROJECT_ROOT" ]; then
    wx_error "项目根目录不存在: $PROJECT_ROOT"
    return 1
  fi

  if [ ! -f "$PROJECT_ROOT/project.config.json" ]; then
    wx_error "缺少 project.config.json: $PROJECT_ROOT"
    failed=1
  fi

  if [ ! -d "$PROJECT_ROOT/miniprogram" ]; then
    wx_error "缺少 miniprogram/ 目录: $PROJECT_ROOT"
    failed=1
  fi

  if ! detect_app_json >/dev/null; then
    wx_error "缺少 app.json 或 miniprogram/app.json"
    failed=1
  fi

  return "$failed"
}

check_devtools_port() {
  local url="http://${WX_DEVTOOLS_HOST}:${WX_DEVTOOLS_PORT}"
  local output
  local status

  set +e
  output="$(curl -sS --max-time 2 "$url" 2>&1)"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    if [ -n "$output" ]; then
      wx_info "服务端口可访问: $url, 返回摘要: $(wx_truncate "$output" 300)"
    else
      wx_info "服务端口可访问: $url, 返回为空"
    fi
    return 0
  fi

  wx_error "服务端口不可访问: $url, curl 退出码 $status, 返回摘要: $(wx_truncate "$output" 300)"
  return 1
}

require_wx_cli() {
  check_wx_cli || exit 1
}

require_project_root() {
  check_project_root || exit 1
}
