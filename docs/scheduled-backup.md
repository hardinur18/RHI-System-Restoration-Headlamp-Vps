# Scheduled VPS backup

The backup source is the VPS database at its archive timestamp. While staff still
use the old Cloud app, this does **not** back up their subsequent Cloud writes and
does not replace the final migration delta.

## Contents and layout

- `Data CSV` contains readable operational tables and an index for import into
  Google Sheets. Original types, credentials, Auth and all tables are retained in
  the encrypted database archive. CSV is a reading aid, not a full restore format.
- `Backup Pemulihan/restic` contains encrypted database archives, roles,
  configuration, backend functions, certificates, Storage metadata and the exact
  deployed frontend artifact. Its recovery key stays separate from Drive.
- `Daftar Foto dan Dokumen.json` maps each object's original name, ID, version,
  size, SHA-256 and `drive_path`. Resolve `drive_path` relative to the private
  application folder, not relative to the dated snapshot.
- The original verified `Backup-20261106T063214Z` remains pinned. Unchanged photos
  reuse its files. New versions go into `Backup Otomatis/Foto & Dokumen`, keyed by
  object ID and content digest. Dated CSV/recovery packages go into
  `Backup Otomatis/Snapshot/<UTC timestamp>`.

Google OAuth remains `drive.file`: files created by or selected for this
application. Every upload checks the configured folder, its parent, ownership,
private sharing, quota and duplicate paths. No broader Drive permission is needed.

## Schedule and retention

The existing local database archive starts daily at **03:30 WIB**. The separate
Drive pipeline is configured for **03:45 WIB**, with up to one minute jitter.
The services use locks; overlapping work fails visibly instead of corrupting a
package. A missed timer runs when the server returns, but an archive older than
26 hours is rejected. If the database timer has failed, repair it before retrying.

`deploy/scheduled-backup-settings.json` controls daily retention (default 7),
weekly retention (default 4), free-space reserve (2 GiB) and full-download weekday
(Sunday UTC). Retention keeps the latest successful run per day and per ISO week;
the sets overlap. It permanently removes **only completed automatic snapshots**
outside this policy, after a new backup has passed recovery verification and the
local creation receipt matches. The initial backup and shared photo pool are
pinned. Shared-photo garbage collection is not enabled; growth must be monitored.
Migration snapshots and user-created files are outside automatic retention.

To change the clock time, edit the systemd timer's `OnCalendar` (with explicit
`Asia/Jakarta`), validate it with `systemd-analyze calendar`, then reload and
restart the timer. To change retention, update the private settings JSON on the
VPS after reviewing the resulting retention plan. Existing photo paths must not
be moved manually.

## Verification and failure handling

1. Validate checksums of the local daily archive.
2. Restore into a new private temporary database, including the migration guard
   schema required by the preview triggers. Restore only application/Auth/Storage
   schemas and their migration metadata; no jobs or services connect to it.
3. Export CSV and the Storage inventory from this same restored archive. Reuse
   verified immutable file versions or copy and checksum exact versioned files.
   Missing/changing blobs fail the run. Drop only the temporary database created
   by this run; keep failure evidence.
4. Build and fully restore the local encrypted recovery package.
5. Upload missing bytes without replacing existing immutable backups. Check
   hashes for every referenced file and read every new file back from Drive.
   On the configured weekly day, read back all referenced files.
6. Check the remote Restic repository and restore database/configuration/frontend
   files from Drive, comparing them with the original archives. Write the remote
   `COMPLETE.json` only after these checks succeed, then apply retention.

`scheduled-backup-latest.json`, `scheduled-backup-status.json`,
`scheduled-backup-retention.json` and `scheduled-backup-health.json` live privately
under `/opt/rhi/migration`. The hourly health service reports stale backups,
inactive timers, unconfirmed durable OAuth, low space and failed runs through
systemd/journal. **No email/WhatsApp alert channel is configured.** An administrator
must inspect this status; do not describe local logs as delivered notifications.

A successful archive restore proves recoverability of the captured archive. It
does not compare against a later changing production database. A full new-host
disaster-recovery rehearsal and recovery-key escrow remain separate operations.

## Installation and recovery

Upload the reviewed `deploy/*scheduled-backup*.py`, settings JSON and the four
`rhi-offsite-backup` / `rhi-backup-health` unit files into `/opt/rhi/migration`.
The existing readable-preparation/finalization scripts and updated database
backup script are dependencies. Credentials and private settings must be root-only.

Run `prepare-scheduled-backup.py`, then `upload-scheduled-backup.py` for the first
verified package. `install-scheduled-backup.py` refuses to enable timers until a
fresh verified upload and an operator-observed Production OAuth reauthorization
receipt exist. Never manufacture this receipt from token expiry alone: access
tokens are short-lived even when the refresh grant is durable.

After a failed preparation, inspect the private restore log and partial snapshot;
do not delete or overwrite a migration snapshot merely to retry. An interrupted
upload is resumable if the staged files match. A changed immutable remote file
or duplicate path requires investigation and fails closed.

To recover, obtain the separate Restic key, verify the completion receipt and
snapshot checksums, restore encrypted archives, and fetch **every photo referenced
by that snapshot's index**. Verify each photo's size and SHA-256 before rebuilding
Storage. Restore into an isolated environment first; never overwrite the running
app as a test. Retain the selected snapshot and all referenced photos together.
