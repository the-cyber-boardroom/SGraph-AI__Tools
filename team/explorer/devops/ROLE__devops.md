# Role: DevOps — sgraph_ai__tools

**Team:** Explorer
**Scope:** CI/CD pipelines per module, S3 deployment, CloudFront config, cache headers

---

## Responsibilities

1. **CI/CD pipeline** — GitHub Actions: per-module change detection, deploy to S3
2. **S3 deployment** — static site hosting, folder-based versioning
3. **CloudFront config** — CDN distribution, cache headers, CORS
4. **Cache headers** — immutable for pinned versions, 5-min for latest
5. **Local dev** — simple static file server for testing

## Deployment Architecture

```
GitHub Actions
  -> Detect which module changed (core/crypto/, tools/ssh-keygen/, etc.)
  -> Run module-specific tests (if any)
  -> Deploy changed files to S3
  -> Invalidate CloudFront cache for changed paths

S3 Bucket: tools.sgraph.ai
  -> Static website hosting
  -> Folder structure matches repo structure

CloudFront Distribution
  -> Cache-Control: public, max-age=31536000, immutable  (pinned versions)
  -> Cache-Control: public, max-age=300                   (latest/)
  -> Access-Control-Allow-Origin: *.sgraph.ai
```

## Local Development

```bash
# No dependencies to install — it's all vanilla JS and static files
python3 -m http.server 8080
# or
npx serve .

# Open http://localhost:8080/tools/
```

## Review Documents

Place reviews at: `team/explorer/devops/reviews/{date}/`
