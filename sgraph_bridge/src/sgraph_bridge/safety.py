"""Path safety helpers for sgraph_bridge.

Every file and bash endpoint resolves user-supplied paths through
`resolve_in_workspace` before touching the filesystem.
"""

from pathlib import Path


class PathOutsideWorkspaceError(Exception):
    """Raised when a resolved path escapes the workspace directory."""


def resolve_in_workspace(path: str, workspace: Path) -> Path:
    """Resolve *path* against *workspace*, reject anything that escapes.

    Args:
        path: A relative path supplied by the caller. Absolute paths are
              rejected unless they start with the workspace directory.
        workspace: The absolute workspace root (will be resolved).

    Returns:
        The fully-resolved absolute Path, guaranteed to be inside *workspace*.

    Raises:
        PathOutsideWorkspaceError: If the path escapes the workspace,
            contains NUL bytes, is absolute and outside workspace, or is empty.
    """
    if not path:
        raise PathOutsideWorkspaceError("Empty path is not allowed.")

    # Reject NUL bytes — some OS calls truncate at NUL.
    if "\x00" in path:
        raise PathOutsideWorkspaceError("Path contains NUL bytes.")

    # Normalise workspace to a resolved absolute path.
    ws = workspace.resolve()

    p = Path(path)

    # Reject absolute paths that are not already inside the workspace.
    # We do NOT silently re-anchor them — callers must supply relative paths.
    if p.is_absolute():
        try:
            p.relative_to(ws)
        except ValueError:
            raise PathOutsideWorkspaceError(
                f"Absolute path '{path}' is outside the workspace."
            )
        # The absolute path is inside workspace — resolve and verify below.
        candidate = p.resolve()
    else:
        candidate = (ws / p).resolve()

    # Strict containment check — resolve() has already followed symlinks.
    try:
        candidate.relative_to(ws)
    except ValueError:
        raise PathOutsideWorkspaceError(
            f"Path '{path}' resolves outside the workspace."
        )

    return candidate
