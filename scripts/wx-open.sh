#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./wx-devtools.config.sh
source "$SCRIPT_DIR/wx-devtools.config.sh"

require_project_root
require_wx_cli

wx_info "Running: \"$WX_CLI\" open --project \"$PROJECT_ROOT\" --port \"$WX_DEVTOOLS_PORT\""

if "$WX_CLI" open --project "$PROJECT_ROOT" --port "$WX_DEVTOOLS_PORT"; then
  wx_info "项目打开命令已执行。"
else
  wx_error "打开项目失败。请确认微信开发者工具已安装、可启动，并且当前项目有访问权限。"
  exit 1
fi
