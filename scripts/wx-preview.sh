#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./wx-devtools.config.sh
source "$SCRIPT_DIR/wx-devtools.config.sh"

require_project_root
require_wx_cli

CLI_HELP="$("$WX_CLI" --help 2>&1 || true)"

if ! printf '%s\n' "$CLI_HELP" | grep -Eq '(^|[[:space:]])preview([[:space:]]|$)'; then
  wx_error "当前 CLI 可能不支持 preview 或命令名称不同。不会用 upload 代替。"
  wx_info "人工操作提示：微信开发者工具 -> 预览。"
  exit 0
fi

wx_info "Running: \"$WX_CLI\" preview --project \"$PROJECT_ROOT\" --port \"$WX_DEVTOOLS_PORT\""

if "$WX_CLI" preview --project "$PROJECT_ROOT" --port "$WX_DEVTOOLS_PORT"; then
  wx_info "preview 命令执行完成。"
else
  wx_error "preview 失败。请确认微信开发者工具已打开、已登录，并且当前账号拥有预览权限。"
  exit 1
fi
