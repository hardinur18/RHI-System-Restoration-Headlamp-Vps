# RHI frontend release — 10 November 2026, 22:14 WIB

Deployed commit `9b6eb6acc8a6aa70783dd8aa3de88b9a43d4d3f3` to
https://rhi.polesheadlamp.id after the user's authorization to push live.
Includes the initial-loading refactor and responsive CS/Pesanan filters.

This is a frontend update. Public RHI remains read-only, with the existing
6 November snapshot. No database delta, provider handover, backend release,
source change or operational cutover was performed.

- Immutable release: `/var/www/rhi/releases/preview-9b6eb6acc8a6`.
- Rollback release: `/var/www/rhi/releases/preview-f27c949`.
- Build and private-value scan passed; infrastructure checks passed.
- External verification at 22:16 WIB matched all 223 public files against
  SHA-256, plus four SPA routes, manifest MIME and service-worker cache policy.
- External write fence remained HTTP 409; webhook GET remained HTTP 503.
- The promoter retained 192 prior public assets for existing browser tabs.
- Safari rendered the live login page and read-only banner. An authenticated
  live workflow was not repeated; filter layouts were checked locally at
  desktop, 768px and 360px before release.

Private deployment receipts: `.migration-local/filter-live-promotion.json`,
`filter-live-infrastructure.json`, and `filter-live-postcheck.json`.
