#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./wx-devtools.config.sh
source "$SCRIPT_DIR/wx-devtools.config.sh"

require_project_root

cd "$PROJECT_ROOT"
wx_info "Running: npm run test:e2e"
npm run test:e2e
