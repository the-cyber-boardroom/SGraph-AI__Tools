#!/usr/bin/env python3
"""Build layered IFD content by merging all patch versions into a _latest directory.

IFD principle: each version folder only contains its DELTAS (new/changed files).
The final deployable state is the result of layering ALL versions in order,
with later versions overwriting earlier ones:

  v0.1.0 (base) → v0.1.1 (overlay) → v0.1.2 → ... → v0.1.5 (latest)

This script creates a _latest/ directory inside the IFD base path that contains
the merged result. The deploy script then uses this as its clean-urls source.

Usage:
  python scripts/build_ifd_latest.py \\
    --source-dir sgraph_ai_tools__static \\
    --ifd-base tools/v0/v0.1 \\
    --up-to v0.1.5
"""

import argparse
import shutil
import sys
from pathlib import Path
from packaging.version import Version


def parse_version(name):
    """Parse a version folder name like 'v0.1.5' into a sortable Version."""
    try:
        return Version(name.lstrip('v'))
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Build layered IFD content from version deltas."
    )
    parser.add_argument(
        "--source-dir", required=True,
        help="Root of the static site (e.g. sgraph_ai_tools__static)"
    )
    parser.add_argument(
        "--ifd-base", required=True,
        help="IFD base path relative to source-dir (e.g. tools/v0/v0.1)"
    )
    parser.add_argument(
        "--up-to", required=True,
        help="Latest version to include (e.g. v0.1.5)"
    )
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    ifd_base = source_dir / args.ifd_base
    target_version = parse_version(args.up_to)

    if not ifd_base.is_dir():
        print(f"ERROR: IFD base directory not found: {ifd_base}")
        sys.exit(1)

    if target_version is None:
        print(f"ERROR: Invalid version: {args.up_to}")
        sys.exit(1)

    # Find all version directories, sorted by version number
    version_dirs = []
    for d in ifd_base.iterdir():
        if d.is_dir() and d.name.startswith('v') and d.name != '_latest':
            v = parse_version(d.name)
            if v is not None and v <= target_version:
                version_dirs.append((v, d))

    version_dirs.sort(key=lambda x: x[0])

    if not version_dirs:
        print(f"ERROR: No version directories found in {ifd_base}")
        sys.exit(1)

    # Create _latest directory
    latest_dir = ifd_base / '_latest'
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    latest_dir.mkdir()

    print(f"Building layered IFD content in {latest_dir}")
    print(f"  Base: {ifd_base}")
    print(f"  Up to: {args.up_to}")
    print(f"  Versions: {len(version_dirs)}")
    print()

    # Layer each version in order
    for version, version_dir in version_dirs:
        file_count = 0
        for src_path in version_dir.rglob('*'):
            if src_path.is_file():
                rel = src_path.relative_to(version_dir)
                dst = latest_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_path, dst)
                file_count += 1

        print(f"  + v{version}: {file_count} files")

    # Count total files in _latest
    total = sum(1 for _ in latest_dir.rglob('*') if _.is_file())
    print(f"\n  = _latest: {total} total files")

    # Show tool directories for verification
    en_gb = latest_dir / 'en-gb'
    if en_gb.is_dir():
        tools = sorted(d.name for d in en_gb.iterdir() if d.is_dir())
        print(f"  Tools: {', '.join(tools)}")


if __name__ == '__main__':
    main()
