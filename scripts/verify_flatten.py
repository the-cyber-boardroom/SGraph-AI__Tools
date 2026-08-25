#!/usr/bin/env python3
"""Verify a flattened release folder is byte-identical to the layered IFD result.

This is the migration gate: it proves that consolidating the v0.1.x delta folders
into a single flat release changed nothing about what gets served.

It layers the IFD version folders in memory (same algorithm as build_ifd_latest.py)
and compares the winning file at every path against the flat release folder, by
SHA-256. Any missing file, extra file, or content difference fails the run.

Intentional deviations (e.g. a tool retired during consolidation) must be listed
in ALLOWED_REMOVALS below, so every difference is a reviewed line of code rather
than a silent drift.

Two modes:
  strict (default)   both trees must match exactly. Use at the moment of the
                     flatten, to prove nothing was lost.
  --allow-additions  the flat release may contain extra files. Use afterwards,
                     while the v0.1.x folders still exist: it keeps catching the
                     failure that matters — a tool added the old way, to a
                     v0.1.x folder, that never reaches the release being shipped.
  --allow-modifications
                     the flat release may also have edited content. Add this once
                     the flat release is being developed on its own; together with
                     --allow-additions it reduces the check to pure path coverage,
                     which is exactly the frozen-tree guard that remains useful.

Usage:
  python scripts/verify_flatten.py \\
    --source-dir sgraph_ai_tools__static \\
    --ifd-base   tools/v0/v0.1 \\
    --flat       tools/v0/v0.3/v0.3.0
"""

import argparse
import hashlib
import re
import sys
from pathlib import Path


# Paths deliberately dropped from the flat release, relative to the release root.
# A prefix match: "en-gb/heic-decode" covers everything beneath it.
ALLOWED_REMOVALS = [
]

# Paths deliberately added to the flat release that no version folder produced.
ALLOWED_ADDITIONS = [
]

# CI-generated artefacts that must never be committed into the flat release.
CI_ARTEFACTS = ["en-us/", "fr-fr/", "de-de/", "es-es/", "_common/js/build-info.js"]


def parse_version_tuple(name):
    m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)$', name)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def layer_versions(ifd_base):
    """Replay every version folder in order; return {relpath: winning source Path}."""
    versions = []
    for d in ifd_base.iterdir():
        if d.is_dir() and d.name.startswith('v') and d.name != '_latest':
            v = parse_version_tuple(d.name)
            if v is not None:
                versions.append((v, d))
    versions.sort(key=lambda x: x[0])

    winners = {}
    for _version, vdir in versions:
        for src in vdir.rglob('*'):
            if src.is_file():
                winners[src.relative_to(vdir).as_posix()] = src
    return winners, len(versions)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def covered(rel, patterns):
    return any(rel == p or rel.startswith(p.rstrip('/') + '/') for p in patterns)


def main():
    ap = argparse.ArgumentParser(description="Verify flat release == layered IFD result.")
    ap.add_argument("--source-dir", required=True)
    ap.add_argument("--ifd-base",   required=True, help="e.g. tools/v0/v0.1")
    ap.add_argument("--flat",       required=True, help="e.g. tools/v0/v0.3/v0.3.0")
    ap.add_argument("--allow-modifications", action="store_true",
                    help="Do not fail on content differences between the two trees. Use once the "
                         "flat release is being edited on its own (Phase 4 onwards): what still "
                         "matters is that no PATH the old tree served has gone missing.")
    ap.add_argument("--allow-additions", action="store_true",
                    help="Do not fail on files present in the flat release but absent from the "
                         "layered result. Use once development has moved to the flat release: "
                         "new content there is expected, while anything missing or changed "
                         "still means a v0.1.x edit that never reached the shipped release.")
    args = ap.parse_args()

    source_dir = Path(args.source_dir).resolve()
    ifd_base   = source_dir / args.ifd_base
    flat_dir   = source_dir / args.flat

    for label, p in (("IFD base", ifd_base), ("flat release", flat_dir)):
        if not p.is_dir():
            print(f"ERROR: {label} directory not found: {p}")
            sys.exit(1)

    winners, n_versions = layer_versions(ifd_base)
    flat = {p.relative_to(flat_dir).as_posix(): p
            for p in flat_dir.rglob('*') if p.is_file()}

    print(f"Layered  {args.ifd_base}: {n_versions} version folders -> {len(winners)} served files")
    print(f"Flat     {args.flat}: {len(flat)} files")
    print()

    missing   = sorted(set(winners) - set(flat))
    extra     = sorted(set(flat) - set(winners))
    differing = ([] if args.allow_modifications
                 else sorted(rel for rel in set(winners) & set(flat)
                             if sha256(winners[rel]) != sha256(flat[rel])))

    unexpected_missing = [r for r in missing if not covered(r, ALLOWED_REMOVALS)]
    unexpected_extra   = ([] if args.allow_additions
                          else [r for r in extra if not covered(r, ALLOWED_ADDITIONS)])
    artefacts          = [r for r in flat    if covered(r, CI_ARTEFACTS)]

    ok = True

    if unexpected_missing:
        ok = False
        print(f"FAIL: {len(unexpected_missing)} file(s) served today but absent from the flat release:")
        for r in unexpected_missing[:40]:
            print(f"  - {r}")
        if len(unexpected_missing) > 40:
            print(f"  … and {len(unexpected_missing) - 40} more")
        print()

    if unexpected_extra:
        ok = False
        print(f"FAIL: {len(unexpected_extra)} file(s) in the flat release that no version folder produced:")
        for r in unexpected_extra[:40]:
            print(f"  + {r}")
        if len(unexpected_extra) > 40:
            print(f"  … and {len(unexpected_extra) - 40} more")
        print()

    if differing:
        ok = False
        print(f"FAIL: {len(differing)} file(s) differ in content:")
        for r in differing[:40]:
            print(f"  ~ {r}")
        if len(differing) > 40:
            print(f"  … and {len(differing) - 40} more")
        print()

    if artefacts:
        ok = False
        print(f"FAIL: {len(artefacts)} CI-generated artefact(s) committed into the flat release:")
        for r in sorted(artefacts)[:20]:
            print(f"  ! {r}")
        print()

    allowed = len(missing) - len(unexpected_missing)
    if not args.allow_additions:
        allowed += len(extra) - len(unexpected_extra)
    if allowed:
        print(f"  ({allowed} deviation(s) matched an explicit allow-list entry)")

    if ok:
        if args.allow_modifications:
            print(f"PASS: every path the layered result serves still exists in the flat "
                  f"release ({len(winners)} paths checked).")
            if extra:
                print(f"      {len(extra)} file(s) exist only in the flat release.")
            print(f"      Content differences were not checked (--allow-modifications).")
        elif args.allow_additions and extra:
            print(f"PASS: every file the layered result serves is present and identical in the "
                  f"flat release ({len(winners)} files verified).")
            print(f"      {len(extra)} file(s) exist only in the flat release — expected, since "
                  f"development has moved there.")
        else:
            print(f"PASS: the flat release is byte-identical to the layered result "
                  f"({len(winners)} files verified).")
        sys.exit(0)

    print("Flat release does NOT match the layered result. See failures above.")
    sys.exit(1)


if __name__ == '__main__':
    main()
