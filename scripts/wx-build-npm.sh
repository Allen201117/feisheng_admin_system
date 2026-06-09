#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./wx-devtools.config.sh
source "$SCRIPT_DIR/wx-devtools.config.sh"

require_project_root
require_wx_cli

CLI_HELP="$("$WX_CLI" --help 2>&1 || true)"

if ! printf '%s\n' "$CLI_HELP" | grep -Eq '(^|[[:space:]])build-npm([[:space:]]|$)'; then
  wx_error "当前 CLI 可能不支持 build-npm 或命令名称不同。"
  wx_info "人工操作提示：微信开发者工具 -> 工具 -> 构建 npm。"
  exit 0
fi

wx_info "Running: \"$WX_CLI\" build-npm --project \"$PROJECT_ROOT\" --port \"$WX_DEVTOOLS_PORT\""

set +e
BUILD_OUTPUT="$("$WX_CLI" build-npm --project "$PROJECT_ROOT" --port "$WX_DEVTOOLS_PORT" 2>&1)"
BUILD_STATUS=$?
set -e

printf '%s\n' "$BUILD_OUTPUT"

if printf '%s\n' "$BUILD_OUTPUT" | grep -q '__NO_NODE_MODULES__'; then
  wx_info "当前 miniprogramRoot 下没有可构建的 npm 包；如果后续引入小程序 npm 包，请先在微信开发者工具中确认 npm 构建配置。"
  exit 0
fi

if [ "$BUILD_STATUS" -ne 0 ] || printf '%s\n' "$BUILD_OUTPUT" | grep -Eq '(^|\[)error(\]|:)|✖'; then
  wx_error "构建 npm 失败。请确认微信开发者工具已打开、已登录，并尝试人工操作：微信开发者工具 -> 工具 -> 构建 npm。"
  exit 1
fi

wx_info "构建 npm 命令执行完成。"
