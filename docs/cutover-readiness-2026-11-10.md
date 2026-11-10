# RHI pre-cutover readiness — 10 November 2026

Historical preparation record. The authorized operational cutover at 23:02 WIB
is recorded in [cutover-live-2026-11-10.md](cutover-live-2026-11-10.md).
The preview/source-ownership statements below describe the earlier state.

Status: preparation advanced; **not a 100% go-live approval**. Staff continue
writing to the old app. Public RHI remains a read-only preview of the 6 November
19:33 WIB snapshot. No callbacks, source schedules or source data were changed.

Update 16:10 WIB: repeated backtesting reproduced a chat-read timeout. A bounded
8-second read-timeout candidate passed three fresh-worker runs, and the historical
111-table delta/rollback rehearsal passed. See `backtest-three-gates-2026-11-10.md`
for evidence and limitations. The initial kit `2a03278` below is superseded by the
new tested configuration; do not use it as the final cutover configuration.

## Verified this session

- Eight source Edge Functions have no version/bundle/JWT-setting drift versus
  the inspected 6 November inventory (checked 13:12 WIB).
- Scoped Ads candidate SHA-256:
  `d9c363872744194269d3eff5be4255a108e10f95297299034ddb32c1e882b071`.
  Its predecessor is `ca077a4176b2709fe257eddfc5c8efdf9c90bc39450340593901e6c6b8354ea2`.
  Only `executeAdsDailySync` changed in the preserved source bundle. Official
  ESZIP parser and byte comparison verified all other modules/assets unchanged.
  `RHI_ADS_SYNC_PROVIDERS=meta` prevents scheduled jobs invoking deferred Google
  Ads/TikTok; an invalid explicit scope fails before provider calls. Omitted scope
  retains source behavior. Actual function unit tests cover calls and failures.
- The candidate passed **67 isolated UAT checks** at 13:22 WIB: 24 messaging
  contracts with a fake provider, 21 business-write checks, 22 payroll/form/Storage
  checks. Fixtures removed and original UAT bundle restored. The first run hit
  `KV getByPrefix timeout` fetching chat; the second complete run passed. This is
  a recorded transient failure, not proof of load capacity or live WA delivery.
- Scheduler preparation was exercised transactionally and rolled back. All three
  jobs remained inactive and the launcher off. The Cloud-only URL validator needs
  the prepared VPS-specific replacement; blindly invoking the old function with
  the VPS URL fails. Vault endpoints/anon key, Ads scheduler hash and Meta dispatch
  token are checked without printing credentials.
- Strict-core TypeScript found an unchecked follow-up template index. It now
  enters the existing no-template branch when no template exists. Strict-core,
  all six modular typechecks and 13 core workflow contracts passed afterward.
- Router authentication/network tests and 12 deployment-boundary contexts passed.
  The production overlay remains a candidate; public runtime still uses staging
  isolation. No provider egress was opened publicly.
- Seven VPS services healthy, correct Auth issuer, TLS with 84 days remaining,
  66.27 GiB disk free, SQL write fences active, cron inactive (13:25 WIB).
- Drive backup `20261110T054547Z`: 15,443 Storage objects inventoried, 901,404,264
  new bytes uploaded; new-file download/checksum, remote inventory and recovery
  verification passed. Daily Drive backup **03:45 WIB** and hourly local health
  checks enabled. Local database backup remains **03:30 WIB**.
- Owner retained seven-day Google Testing authorization; expiry **13 November,
  19:17 WIB**. Renewal is required; no external alert delivery is configured.

## Latest-data difference (not yet applied)

Read-only consistent comparison completed at 13:21 WIB across 111 tables.
24 tables differ: 34,228 inserted, 1,101 updated and 505 deleted rows across all
schemas, including chat/Auth data. Orders alone: source 9,444 versus target 9,363;
81 inserted and 63 updated. This is a planning snapshot, not final parity.
Source is still changing. Private plan: `/opt/rhi/backups/delta-20261110T061204Z`.
Do not apply without fresh target preconditions and matching verified Storage bytes.

## Private cutover artifact

After committing reviewed changes, build using
`node scripts/build-vps-preview.mjs --production`, then run
`node scripts/prepare-cutover-kit.mjs`. Output stays under `.migration-local`.
The kit contains a writable frontend, the tested scoped bundle, reviewed router,
staging/production Compose overlays and the inactive-scheduler preparation script.
Every file has a checksum and the exact source commit is recorded in `kit.json`.

Stage under `/opt/rhi/migration/cutover-<commit12>`, outside the webroot, and run
`python3 <kit>/verify-cutover-kit.py <kit>`. This verifies checksums, predecessor,
Compose rendering, private ports and current preview fences; it never activates
services or changes the public frontend. Compose's router volume points to the
installed path: the reviewed router must be installed and its hash verified at
cutover. Copying the production overlay alone is insufficient.

Prepared and verified: commit `2a0327802df7454b91147948276fd7e32bbdd5cc`,
kit `/opt/rhi/migration/cutover-2a0327802df7`. All **221 artifact checksums**,
Compose rendering, private port bindings and preserved preview fences passed.
Build, secret scan and PWA generation passed; the kit is **not activated**.
The first macOS tar included AppleDouble metadata and was rejected by the exact
inventory check. A metadata-free Python tar archive passed; the rejected staging
directory is retained separately. No inventory guard was weakened.

External postcheck: frontend 200; Auth health with the public anon API key 200;
application writes 409; webhook GET 503 and webhook POST 409. Source operation and
public read-only behavior were preserved. Code was pushed to
`origin/chore/vps-isolated-migration`.

## Gates still required

1. An explicitly authorized internal WhatsApp recipient and active sender, then
   a real outbound delivery/receipt check. Synthetic contract tests are complete;
   no unsolicited message has been sent. Live inbound callback ownership is checked
   during the coordinated handover, not switched while staff use the source.
2. Physical Android/iPhone acceptance: login persistence, navigation, install/open,
   keyboard, camera/file upload and offline/reconnect behavior. Desktop emulation
   does not establish device acceptance. Existing PWA update/offline tests remain
   documented in `mobile-pwa-audit-2026-11-10.md` and `pwa-release-2026-11-10.md`.
3. Agree the night cutover window and stop **all source writers**, including staff,
   forms, webhooks, queues and cron. Preserve pending events with idempotency.
4. Take fresh recoverable backups; regenerate/apply the final delta and validate
   every table/relationship/sequence/Auth record and actual Storage bytes. Repeat
   source function/scheduler drift checks and check the OAuth grant is still valid.
5. Install the reviewed frontend/backend/router together, configure schedulers with
   `prepare-vps-schedulers.py --apply-inactive` after the final delta, then transfer
   provider and scheduler ownership once. Keep source read-only. Run final login,
   order, upload, finance and live integration checks before declaring completion.

Google Ads/TikTok are deferred, Cekat unused, SMTP deferred with admin reset, and
the three old placeholder pages remain unavailable as agreed. These are explicit
release-scope decisions, not undiscovered migration omissions.

Before new target writes, rollback restores the prior preview and source ownership.
After any target writes, pause and reconcile target transactions/events before
rollback; never restore an old database over accepted new transactions.
