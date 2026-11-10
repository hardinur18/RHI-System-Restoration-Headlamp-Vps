# RHI VPS operational cutover — 10 November 2026

RHI became writable at **23:02:45 WIB** on `https://rhi.polesheadlamp.id`.
The owner explicitly confirmed that staff had stopped input and authorized the
final cutover. The original application must no longer receive staff input.
This record supersedes the pre-cutover status in `cutover-readiness-2026-11-10.md`.

## Data and recovery evidence

The final repeatable-read snapshot began at **22:52:51 WIB**. Plan:
`/opt/rhi/backups/delta-20261110T155251Z` on the dedicated VPS `srv2126686`.

- All **111 tables** matched the source row digests after the transaction. All
  foreign keys passed explicit validation; sequence reconciliation completed.
- 24 tables changed: 37,551 inserted, 1,128 updated and 505 deleted rows across
  application, Auth and Storage schemas. Those totals include chat/session data.
- **9,457 orders**: 94 inserted and 63 updated, with no order deletions.
- 17,471 leads, 3,935 prospect bookings, 52 profiles and 53 Auth users were copied.
- 32,734 WhatsApp contacts, 31,819 conversations and 450,858 messages were copied.
- All **15,538 Storage objects / 22,643,295,139 bytes** were restored with matching
  versions and SHA-256 checksums. Four migrated objects, one per sampled bucket,
  also matched their archived hashes when fetched through the live Storage API.
- The complete source archive is `source-20261110T154417Z/database.dump`,
  SHA-256 `45b40a0cdd68f974461de0bad66748d70f1b9fa54bd772e96cc62e4db4c74659`.
  The earlier pooler archive `source-20261110T152618Z/database.dump` is incomplete;
  it was stopped only after the direct archive completed. Its separately verified
  Storage cache was reused, not its partial database archive.
- A fresh target rollback archive exists inside the final delta directory.
  **Do not restore it over new VPS transactions.**

The data equality assertion applies to the final snapshot, before subsequent
scheduler work, Auth sessions, webhook arrivals and deliberate test fixtures.
It is not a claim that two independently changing databases remain identical.

## Ownership and runtime

- The original database has `rhi_cutover_source_readonly` ALWAYS triggers on all
  77 public tables. Its three cron jobs are inactive. Cloud-managed Auth/Storage
  tables were not altered; keep the source project available for recovery.
- GitHub's original Ads/Instagram tasks and Supabase function/schema deployment
  workflows were disabled, preventing a second scheduler or replacement of the
  transition relays. The Pages deployment workflow was left unchanged.
- VPS SQL preview fences were removed. Public Nginx now uses the reviewed
  production configuration; database ports and Studio remain private.
- Frontend: commit `e6755e5607cdf19f82ee4b692285944ab24a4e6a`, release
  `/var/www/rhi/releases/production-e6755e5607cd`. Application code is the reviewed
  `9b6eb6a` filter release; intervening commits recorded deployment evidence.
  All 223 frontend files matched the manifest over public HTTPS, including four
  SPA routes and PWA cache/MIME checks. The deployed release metadata records
  production mode and the deployment time.
- The tested backend bundle has SHA-256
  `d9c363872744194269d3eff5be4255a108e10f95297299034ddb32c1e882b071`.
  The installed router supports provider egress explicitly in production mode.
  `RHI_ADS_SYNC_PROVIDERS=meta` and `KV_READ_TIMEOUT_MS=8000` are installed.
- VPS scheduler Vault credentials/endpoints were prepared with jobs inactive.
  After rechecking source ownership, the VPS launcher and exactly three jobs were
  enabled at 23:04 WIB: conversion dispatch every two minutes, Ads incremental
  sync every 15 minutes and seven-day reconciliation at 02:17 WIB.
- Use **all four** Compose files when managing the live stack:
  `docker-compose.yml`, `compose.staging.yml`, `compose.production.yml`,
  `compose.scheduler.yml`, with project `supabase` and profile `functions-ready`.
  The production overlay alone deliberately leaves the cron launcher off.
- Instagram token maintenance now runs on the VPS at **03:17 WIB**, using
  `rhi-instagram-refresh.timer`. It updates migrated KV state and local worker
  credentials, never Cloud secrets. The initial check required no rotation;
  expiry was 26 December 2026. Mocked tests covered successful rotation, rejected
  rotation preserving credentials, and retrying a failed worker reload without
  rotating again. An actual future rotation has not yet occurred on this VPS.

## Webhooks and verification

Meta's active `whatsapp_business_account/messages` subscription now points to
`https://api-rhi.polesheadlamp.id/functions/v1/meta-messaging-webhook`.
The provider update and read-back succeeded without changing subscribed fields.
Both original Meta/Kirimdev function URLs now relay to the corresponding VPS
handler, preserving raw bytes and signature headers for delayed retries.

- Verification challenges passed through both the old and new Meta addresses.
- Unsigned POSTs were rejected with 401 at all four old/new webhook endpoints.
- Two signed **empty** events, one through each Meta address, were accepted and
  found in the VPS database. Only their uniquely marked fixtures were removed.
  These probes sent no WhatsApp message and do not establish real message delivery.
- Natural provider traffic subsequently supplied eight distinct incoming message
  IDs; all eight were present in `public.whatsapp_messages`. Nine webhook events
  included a repeated message. This establishes live inbound persistence, not an
  outgoing-send test. Counts are a point-in-time observation and keep increasing.
- The first automatic Ads run at 23:15 WIB returned HTTP 200, `succeeded`, with
  Meta in `success` state. Repeated conversion-dispatch calls also returned 200.
  A scan found no source-project URL in public SQL function definitions, cron
  commands or Vault URL values on the target.
- Password login and **34 application read/anonymous-denial checks** passed on
  the synchronized backend; the temporary Auth/profile fixture was removed.
- A temporary private bucket passed upload/download SHA verification and signed
  download; the object and bucket were removed.
- After the database restart, fresh password login and the orders, leads and
  profiles endpoints each returned two real rows while rejecting anonymous reads.
  The fixture was removed. There were 17 orders scheduled for 10 November.
- Safari's existing PWA preview showed the normal update prompt. After selecting
  “Perbarui sekarang”, the operational login page loaded without the old read-only
  banner. This is desktop PWA update evidence, not physical-phone acceptance.
- Previous isolated tests covered order lifecycle, finance, stock costing,
  payroll, forms, booking and messaging contracts; see the backtest documents.

## Backups and remaining acceptance

The first post-cutover local archive is `20261110T160411Z` (23:04 WIB). Its
readable package passed an isolated restore: 75 application tables, 102 CSV data
files, 668,540 CSV rows, and all 15,538 photos/documents. Drive verification
completed at **23:20:28 WIB**, under `Backup Otomatis/Snapshot/20261110T160411Z`:
15,662 remote files matched checksums, all 224 non-baseline files were downloaded
and checked, and the encrypted database/configuration/frontend recovery archive
was restored from Drive and matched the original. The upload added 952,440,073
bytes and reused 15,438 baseline photos; it did not upload another full photo copy.
Receipt: `/opt/rhi/migration/scheduled-upload-20261110T160411Z/report.json`.

Local backup remains 03:30 WIB; Drive backup 03:45 WIB. The owner retained Google
OAuth Testing with seven-day authorization, expiring **13 November, 19:17 WIB**.
Renew that authorization before expiry. No change to billing or OAuth publication
was made. Future configuration backups include the scheduler overlay and the
Instagram maintenance files.

Do not label the release “100% acceptance tested”: a real outgoing WhatsApp test
still needs one explicitly identified internal recipient; physical Android/iPhone
acceptance is also pending. No customer message was sent during cutover.
Google Ads/TikTok, Cekat, SMTP self-service reset, and the three old placeholder
pages retain their previously agreed deferred/unused status.

The original frontend is not redirected. Staff must use the new RHI URL. Public
booking/embed links should use the RHI origin; the snapshot contained no active
embed form records. Localhost still uses the separate older UAT database and is
not evidence of live VPS counts. Do not point a local test build at writable
production merely to make its counts match.

After accepted VPS writes, any rollback requires pausing and reconciling new
transactions/events first. The source-resume helper is only for a rollback before
cutover and must not be used to reopen the old application now.
