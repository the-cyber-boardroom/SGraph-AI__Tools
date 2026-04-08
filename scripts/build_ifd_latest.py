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
import re
import shutil
import sys
from pathlib import Path


def parse_version_tuple(name):
    """Parse a version folder name like 'v0.1.5' into a sortable tuple (0, 1, 5)."""
    m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)$', name)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def find_all_versions(ifd_base):
    """Discover all version directories in the IFD base, sorted ascending."""
    versions = []
    for d in ifd_base.iterdir():
        if d.is_dir() and d.name.startswith('v') and d.name != '_latest':
            v = parse_version_tuple(d.name)
            if v is not None:
                versions.append((v, d))
    versions.sort(key=lambda x: x[0])
    return versions


def find_latest_version(ifd_base):
    """Find the highest semver version directory in the IFD base."""
    versions = find_all_versions(ifd_base)
    if not versions:
        return None
    return versions[-1]


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
        help="Latest version to include (e.g. v0.1.5) or 'auto' to detect"
    )
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    ifd_base = source_dir / args.ifd_base

    if not ifd_base.is_dir():
        print(f"ERROR: IFD base directory not found: {ifd_base}")
        sys.exit(1)

    # Auto-detect latest version if requested
    if args.up_to == 'auto':
        latest = find_latest_version(ifd_base)
        if latest is None:
            print("ERROR: No version directories found — cannot auto-detect")
            sys.exit(1)
        target_version = latest[0]
        ver_str = f"v{latest[0][0]}.{latest[0][1]}.{latest[0][2]}"
        print(f"Auto-detected latest version: {ver_str}")
    else:
        target_version = parse_version_tuple(args.up_to)
        if target_version is None:
            print(f"ERROR: Invalid version: {args.up_to}")
            sys.exit(1)

    # Warn if --up-to skips newer versions
    all_versions = find_all_versions(ifd_base)
    max_version = max(v for v, _ in all_versions) if all_versions else None
    if max_version and target_version < max_version:
        skipped = [f"v{v[0]}.{v[1]}.{v[2]}" for v, _ in all_versions if v > target_version]
        print(f"WARNING: --up-to skips {len(skipped)} newer version(s): {', '.join(skipped)}")

    # Find all version directories up to target, sorted by version number
    version_dirs = [(v, d) for v, d in all_versions if v <= target_version]

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

        ver_str = f"{version[0]}.{version[1]}.{version[2]}"
        print(f"  + v{ver_str}: {file_count} files")

    # Count total files in _latest
    total = sum(1 for _ in latest_dir.rglob('*') if _.is_file())
    print(f"\n  = _latest: {total} total files")

    # Show tool directories for verification
    en_gb = latest_dir / 'en-gb'
    if en_gb.is_dir():
        tools = sorted(d.name for d in en_gb.iterdir() if d.is_dir())
        print(f"  Tools: {', '.join(tools)}")

    # Post-build verification
    expected = latest_dir / 'en-gb' / 'index.html'
    if not expected.is_file():
        print(f"\nERROR: Build verification failed — {expected} not found")
        sys.exit(1)
    print("\n  Build verified: en-gb/index.html exists")


if __name__ == '__main__':
    main()
