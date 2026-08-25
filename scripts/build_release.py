#!/usr/bin/env python3
"""Assemble a deployable release tree from a flat release folder.

Replaces the IFD layering step. Where build_ifd_latest.py had to replay N delta
folders to discover what gets served, this simply copies the flat release folder
that already IS the served content, and adds the two shared tiers next to it.

Output layout (this is exactly what the CDN serves at the site root):

    build/
      index.html            locale detector, from the static root
      404.html robots.txt sitemap.xml manifest.json
      _common/  i18n/  en-gb/
      core/                 shared modules, root-absolute /core/… imports
      components/           shared components, root-absolute /components/… imports

Locale folders (en-us/, fr-fr/, …) and _common/js/build-info.js are added
afterwards by generate_tools_i18n_pages.py and inject_build_version.py, which
both run against this directory.

Usage:
  python scripts/build_release.py \\
    --source-dir  sgraph_ai_tools__static \\
    --release-dir tools/v0/v0.3/v0.3.0 \\
    --out         build \\
    --version     v0.3.1
"""

import argparse
import re
import shutil
import sys
from pathlib import Path


SHARED_TIERS = ["core", "components"]

# Files that must exist in the output for the release to be servable.
REQUIRED = ["index.html", "en-gb/index.html", "_common", "core", "components"]


def series_of(version):
    """Return the major.minor series of a version string, e.g. 'v0.3.1' -> (0, 3)."""
    m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)$', version.strip())
    return (int(m.group(1)), int(m.group(2))) if m else None


def series_of_release_dir(release_dir):
    """Return the major.minor series encoded in a release path's leaf, e.g.
    'tools/v0/v0.3/v0.3.0' -> (0, 3)."""
    return series_of(Path(release_dir).name)


def copy_tree(src, dst):
    """Copy a directory tree into dst, returning the number of files copied."""
    count = 0
    for path in src.rglob('*'):
        if path.is_file():
            target = dst / path.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            count += 1
    return count


def main():
    ap = argparse.ArgumentParser(description="Assemble a deployable release tree.")
    ap.add_argument("--source-dir",  required=True, help="Static site root (e.g. sgraph_ai_tools__static)")
    ap.add_argument("--release-dir", required=True, help="Flat release folder, relative to source-dir")
    ap.add_argument("--out",         required=True, help="Output directory to assemble into")
    ap.add_argument("--version",     required=True, help="Release version being built (e.g. v0.3.1)")
    args = ap.parse_args()

    source_dir  = Path(args.source_dir).resolve()
    release_dir = source_dir / args.release_dir
    out_dir     = Path(args.out).resolve()

    if not release_dir.is_dir():
        print(f"ERROR: release directory not found: {release_dir}")
        sys.exit(1)

    # ----- Guard: the version and the release folder must be the same series -----
    # Without this, bumping the version file to v0.4.x while still building
    # tools/v0/v0.3/v0.3.0 would silently publish the old tree under a new number.
    v_series = series_of(args.version)
    d_series = series_of_release_dir(args.release_dir)
    if v_series is None:
        print(f"ERROR: --version is not a X.Y.Z version: {args.version}")
        sys.exit(1)
    if d_series is None:
        print(f"ERROR: --release-dir leaf is not a vX.Y.Z folder: {args.release_dir}")
        sys.exit(1)
    if v_series != d_series:
        print(f"ERROR: version/release-dir series mismatch.")
        print(f"  --version     {args.version}       -> series v{v_series[0]}.{v_series[1]}")
        print(f"  --release-dir {args.release_dir} -> series v{d_series[0]}.{d_series[1]}")
        print(f"  Bump the release folder to the new series, or correct the version file.")
        sys.exit(1)

    # ----- Assemble -----
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    print(f"Building release {args.version}")
    print(f"  from : {args.release_dir}")
    print(f"  into : {out_dir}")
    print()

    n = copy_tree(release_dir, out_dir)
    print(f"  + release content : {n:>4} files")

    for tier in SHARED_TIERS:
        tier_src = source_dir / tier
        if not tier_src.is_dir():
            print(f"ERROR: shared tier not found: {tier_src}")
            sys.exit(1)
        n = copy_tree(tier_src, out_dir / tier)
        print(f"  + {tier:<16}: {n:>4} files")

    # The static root index.html is the locale detector and must win over the
    # release's own index.html, which only covers the shipped locales.
    root_index = source_dir / "index.html"
    if root_index.is_file():
        shutil.copy2(root_index, out_dir / "index.html")
        print(f"  + locale detector : index.html (overrides release root index)")

    # ----- Verify -----
    print()
    missing = [r for r in REQUIRED if not (out_dir / r).exists()]
    if missing:
        print("ERROR: release tree is incomplete — missing:")
        for r in missing:
            print(f"  - {r}")
        sys.exit(1)

    total = sum(1 for p in out_dir.rglob('*') if p.is_file())
    tools = sorted(d.name for d in (out_dir / "en-gb").iterdir() if d.is_dir())
    print(f"  = {total} files, {len(tools)} tools")
    print(f"  Verified: {', '.join(REQUIRED)}")


if __name__ == '__main__':
    main()
