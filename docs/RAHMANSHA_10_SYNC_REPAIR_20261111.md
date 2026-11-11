# Rahmansha 10 synchronization repair — 11 November 2026

Scope authorized by owner: repair Rahmansha 10 in localhost and live RHI.

## Cause

The internal account `7s9okdilm` was active and had an active API mapping to `act_1665402543989611`, with an active CS assignment to RismaSari. However, its KV configuration `meta_integration_config:7s9okdilm` was enabled without `liveMetaAccountId` or `liveMetaAccountName` in both production and UAT.

The scheduled sync uses `mappedOnly: true` and builds its eligible account IDs from these KV configurations. It therefore excluded Rahmansha 10 even though the separate relational API mapping existed. November 10 data was present; November 11 data was absent.

## Repair and verification

- Read-only Meta requests using each existing runtime token returned HTTP 200 for the exact account, name Rahmansha 10, account status 1, business `329276652382022` / rahmanshafashion.
- Backed up original configuration and affected data before mutation under `/opt/rhi/migration/rahmansha10-repair-20261111/` on the VPS (private).
- Filled the existing KV configuration with the verified Meta account and business identifiers in `postgres` and `rhi_uat_20261106`, preserving other existing fields.
- Ran the application's normal `/ads/sync-run` endpoint for November 10–11, with `forceProviders: true` and `filters.adAccountId: 7s9okdilm`.
- Run `68fe4d2e-831c-45e7-9d22-45b1637d0082` succeeded: one daily row inserted, one updated, no provider errors, no protected manual rows overwritten. Provider snapshots were refreshed through the standard pipeline; daily-row writes were restricted to the target account. The result also reported two unmapped provider rows outside those two materialized rows.
- Mirrored only this account's November 10–11 snapshots and daily rows into UAT, with a guard against overwriting local manual edits. Verified exact matching date, spend, dashboard leads and edit counts between production and UAT.

Verified values at this sync (not a final daily total):

| Date | Spend | Dashboard leads |
| --- | ---: | ---: |
| 2026-11-10 | Rp713,364 | 64 |
| 2026-11-11 | Rp223,919 | 21 |

Chrome live CS View displayed RismaSari / Rahmansha 10 with Rp223,919 spend and 21 dashboard leads after updating/reloading the existing frontend. Localhost remained on its login page; local data was verified directly in the isolated database. UAT marker still reports `provider_delivery: false`.

The initial configuration repair required no source change. Localhost remains a snapshot environment, not continuous replication of production. No new Meta permissions or credentials were created.

## Follow-up: prevent mapping loss on Live ON/OFF

Owner requested completion after noting the account previously worked. The original KV record's timestamp was October 7, 2026. This proves the incomplete configuration predates this repair, but does not identify who last changed it or establish the exact historical action that produced it.

The real Live ON/OFF UI calls `saveAdsIntegrationConfig(item.id, enabled)` without account fields. The old server rebuilt the entire record from that partial request, deleting the saved mapping. This failure was reproduced against the JavaScript extracted from the actual live bundle: the regression test failed because `liveMetaAccountId` became undefined after OFF.

The configuration-save route now reads the existing server configuration and preserves omitted mapping fields. Explicit empty strings/null still clear a field; supplying a replacement still changes it. Invalid enabled values are rejected. Authorization remains enforced. No frontend UI changes were made.

Validation:

- Regression test passes on repository source and both generated runtime bundles: OFF/ON, repeated toggle, partial rename, replacement, explicit clear, new record, invalid input, denied permission and failed DB read.
- Existing provider-scope tests pass; unrelated providers remain unchanged.
- Official ESZIP parser validates the candidate bundles. All other module bytes and source maps, plus the dependency snapshot, were verified unchanged. Only the configuration-save route in the main module was replaced.
- Runtime test on isolated UAT creates a disposable test user and configuration, invokes real HTTP OFF/ON requests, verifies stored mapping, checks anonymous requests are denied, and removes the fixture user/profile/KV key.
- Tested correction applied to the UAT backend and live backend. Health checks, existing Rahmansha mapping and daily data checks passed after each activation. Original bundles/manifests retained for rollback.
- Automatic live sync at **09:15 WIB** succeeded and included Rahmansha 10. November 11 values at that run: **Rp235,470 / 22 dashboard leads**. These rows were mirrored to UAT and matching values verified again. The automatic run occurred after the data repair and before the preventive backend deployment.

Private runtime receipts and rollback files: `/opt/rhi/migration/rahmansha10-code-fix-20261111/`.

- Live bundle SHA-256: `2cb659866cf498a9b03acf26e9c65f03e1d6adfa1de2fed2b51f85c3cacc8d0c`.
- UAT bundle SHA-256: `70283edcf9a846e9226b347a0732ba6df3a261543e3f7cb0c8681e7fa0c8c81e`.

Git release scope: the configuration-save fix, pinned bundle-patching helper update, regression test and this report, on `chore/vps-isolated-migration` in `hardinur18/RHI-System-Restoration-Headlamp-Vps`. Deployment was restricted to the Meta mapping correction requested for local and live. Pending UI/UX audit work was not deployed.

Before the requested Git release, the active live bundle and manifest were rechecked against the tested SHA-256 above. The backend health endpoint returned HTTP 200, the functions container was running, and the latest recorded automatic sync succeeded with Rahmansha 10 data present. The already-active backend did not require another restart or deployment.
