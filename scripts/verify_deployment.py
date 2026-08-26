#!/usr/bin/env python3
"""Verify a deployed tools site against the release tree that was built for it.

Post-deploy gate for the v0.3.0 cutover: the browser smoke tests prove the build
works locally, this proves the CDN is serving that build correctly.

Checks, in order:
  1. build-info.js reports the expected version (nothing stale is being served)
  2. every tool listed in the release returns 200 at its clean URL
  3. every shared module the tools import resolves at its root-absolute path
  4. root files and each generated locale are present
  5. Cache-Control and Content-Type are set per file type

Usage:
  python scripts/verify_deployment.py --url https://dev.tools.sgraph.ai \\
    --release-dir sgraph_ai_tools__static/tools/v0/v0.3/v0.3.0
  python scripts/verify_deployment.py --url https://dev.tools.sgraph.ai \\
    --release-dir ... --expect-version v0.3.2
"""

import argparse
import concurrent.futures
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


# Module references that are known not to resolve, each with a reason. Kept as an
# explicit list rather than a silent filter so they stay visible in review.
KNOWN_UNRESOLVED = {
    "/core/vault-client/v0/v0.1/v0.1.0/sg-vault-client.js":
        "en-gb/video-recorder/api/save-vault.js is dead code — nothing imports it "
        "(recorder-api.js wires save-folder and save-sg-send only). It dynamically "
        "imports a v0 path of vault-client that has never existed, for a VaultClient "
        "class that exists nowhere in the repo; the shipped v1.2.x module is functional, "
        "not class-based. Unreachable, so never a live failure. Delete the module or "
        "rewrite it against the real API.",
}

LOCALES   = ["en-gb", "en-us", "fr-fr", "de-de", "es-es"]
ROOT_FILES = ["404.html", "robots.txt", "sitemap.xml", "manifest.json", "index.html"]
TIMEOUT   = 30

# extension -> (expected Content-Type fragment, expected max-age)
EXPECTED_HEADERS = {
    ".html": ("text/html",              300),
    ".css":  ("text/css",             86400),
    ".js":   ("javascript",           86400),
    ".json": ("application/json",     86400),
}


def fetch(url, method="GET"):
    """Return (status, headers) for a URL; status 0 on transport failure."""
    req = urllib.request.Request(url, method=method,
                                 headers={"User-Agent": "sgraph-deploy-verify"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, dict(r.headers), r.read() if method == "GET" else b""
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""
    except Exception:
        return 0, {}, b""


def check_many(base, paths, label, results):
    """HEAD every path concurrently; record failures."""
    def one(p):
        status, _h, _b = fetch(base + p, method="HEAD")
        return p, status

    bad = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for path, status in pool.map(one, paths):
            if status != 200:
                bad.append((path, status))

    if bad:
        results.append((label, False, f"{len(bad)}/{len(paths)} failed"))
        for path, status in sorted(bad)[:15]:
            print(f"    {status or 'ERR':>3}  {path}")
        if len(bad) > 15:
            print(f"    … and {len(bad) - 15} more")
    else:
        results.append((label, True, f"{len(paths)} ok"))


def main():
    ap = argparse.ArgumentParser(description="Verify a deployed tools site.")
    ap.add_argument("--url",         required=True, help="Deployed base URL, no trailing slash")
    ap.add_argument("--release-dir", required=True, help="The release tree that was deployed")
    ap.add_argument("--expect-version", default=None,
                    help="Version build-info.js must report (default: any, just report it)")
    ap.add_argument("--skip-locales", action="store_true",
                    help="Only check en-gb (faster; use when locales are not generated)")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    rel  = Path(args.release_dir)
    if not rel.is_dir():
        print(f"ERROR: release dir not found: {rel}")
        sys.exit(1)

    print(f"Verifying {base}")
    print(f"  against {rel}")
    print()

    results = []

    # ----- 1. build-info version -----
    status, _h, body = fetch(f"{base}/_common/js/build-info.js")
    version = None
    if status == 200:
        m = re.search(r"uiVersion\s*:\s*'([^']+)'", body.decode("utf-8", "replace"))
        version = m.group(1) if m else None
    if args.expect_version:
        ok = version == args.expect_version
        results.append(("build-info version", ok,
                        f"serving {version or '?'}, expected {args.expect_version}"))
    else:
        results.append(("build-info version", status == 200, f"serving {version or '?'}"))

    # ----- 2. every tool in the release -----
    tools = sorted(d.name for d in (rel / "en-gb").iterdir() if d.is_dir())
    print(f"  Tools in release: {len(tools)}")
    locales = ["en-gb"] if args.skip_locales else LOCALES
    for loc in locales:
        check_many(base, [f"/{loc}/{t}/" for t in tools], f"tools [{loc}]", results)

    # ----- 3. shared modules the tools actually import -----
    refs = set()
    pattern = re.compile(r"['\"](/(?:core|components)/[A-Za-z0-9._/-]+\.(?:js|css))['\"]")
    for f in rel.rglob("*"):
        if f.is_file() and f.suffix in (".js", ".html"):
            refs.update(pattern.findall(f.read_text(encoding="utf-8", errors="replace")))
    known = sorted(refs & set(KNOWN_UNRESOLVED))
    refs -= set(KNOWN_UNRESOLVED)
    print(f"  Shared modules referenced: {len(refs)}")
    if known:
        print(f"  Known-unresolved, skipped ({len(known)}):")
        for k in known:
            print(f"    {k}")
            print(f"      {KNOWN_UNRESOLVED[k]}")
    check_many(base, sorted(refs), "shared modules", results)

    # ----- 4. root files and landing pages -----
    check_many(base, [f"/{f}" for f in ROOT_FILES], "root files", results)
    check_many(base, [f"/{loc}/" for loc in locales], "locale landing pages", results)

    # ----- 5. headers per file type -----
    samples = {
        ".html": "/en-gb/",
        ".css":  "/_common/css/tools.css",
        ".js":   "/_common/js/sg-tool-registry.js",
        ".json": f"/en-gb/{tools[0]}/manifest.json",
    }
    header_problems = []
    for ext, path in samples.items():
        want_ct, want_age = EXPECTED_HEADERS[ext]
        status, headers, _b = fetch(base + path, method="HEAD")
        ct = headers.get("Content-Type", "")
        cc = headers.get("Cache-Control", "")
        age = re.search(r"max-age=(\d+)", cc)
        if status != 200:
            header_problems.append(f"{path} -> {status}")
            continue
        if want_ct not in ct:
            header_problems.append(f"{path} Content-Type '{ct}' lacks '{want_ct}'")
        if not age:
            header_problems.append(f"{path} has no Cache-Control max-age (got '{cc or 'none'}')")
        elif int(age.group(1)) != want_age:
            header_problems.append(f"{path} max-age={age.group(1)}, expected {want_age}")
    if header_problems:
        results.append(("headers", False, f"{len(header_problems)} problem(s)"))
        for p in header_problems:
            print(f"    {p}")
    else:
        results.append(("headers", True, f"{len(samples)} file types correct"))

    # ----- report -----
    print()
    print(f"{'CHECK':<26} {'':<6} DETAIL")
    failed = 0
    for label, ok, detail in results:
        print(f"  {label:<24} {'PASS' if ok else 'FAIL':<6} {detail}")
        failed += 0 if ok else 1

    print()
    if failed:
        print(f"{failed} check(s) failed.")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
