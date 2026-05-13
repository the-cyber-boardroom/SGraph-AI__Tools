#!/usr/bin/env bash
# Run the bridge locally with hot-reload (no Docker needed).
# Usage: cd sgraph_bridge && bash scripts/run-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

# Default workspace to ./_sgraph-workspace relative to CWD.
export SGRAPH_WORKSPACE="${SGRAPH_WORKSPACE:-./_sgraph-workspace}"
mkdir -p "${SGRAPH_WORKSPACE}"

echo "Starting sgraph_bridge on http://localhost:8000"
echo "Workspace: ${SGRAPH_WORKSPACE}"

uvicorn sgraph_bridge.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --reload-dir src/sgraph_bridge
