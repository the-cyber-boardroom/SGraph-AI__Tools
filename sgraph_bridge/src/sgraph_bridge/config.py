"""Configuration constants for sgraph_bridge."""

import os
from pathlib import Path

# Workspace directory — overridable via env var for testing.
# In Docker this is the mount point /workspace.
WORKSPACE: Path = Path(os.environ.get("SGRAPH_WORKSPACE", "/workspace"))

# Service version (kept in sync with pyproject.toml).
VERSION: str = "0.1.0"

# Maximum bytes returned per stdout or stderr stream (200 KB).
MAX_OUTPUT_BYTES: int = 200 * 1024

# Default bash timeout in seconds.
DEFAULT_TIMEOUT_S: int = 30
