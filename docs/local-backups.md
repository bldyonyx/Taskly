# Local backups

Settings contains **Export data**, **Import data**, and **Download recovery copy**.
Export reads the seven existing Taskly keys without running their loaders or
normalizing their contents. The file contains personal task data in plain text.

The JSON envelope uses `format: "taskly-local-backup"`, `version: 1`, an
`exportedAt` timestamp, and `values`. All seven keys must be present in `values`.
Each value is the exact localStorage string, or `null` if the key was absent.
Missing keys, extra storage keys, invalid value types, malformed JSON, and
unsupported versions are rejected before any storage writes. Inner strings are
intentionally not parsed: even damaged original values can be backed up.

Import validates the file, then requires **Replace local data** confirmation.
An explicit `null` removes that key during restoration. Canceling or dismissing
Settings leaves the seven keys unchanged. A successful restore reloads Taskly
through its existing loaders, including their existing normalization and legacy
fallback behavior. Export captures stored data, not unsubmitted input text.

Before replacement, Taskly saves and verifies a complete copy of the current seven
values in the additional `taskly.backupRecovery.v1` key. The seven original key
names are unchanged. This copy is kept after success and can be downloaded from
Settings, then imported like any other backup. Each subsequent restore replaces
the recovery copy; download it first if it must be retained longer.

The recovery record is marked pending before replacement. Failed writes trigger
rollback. Startup recovers a pending operation before the app's normal loaders or
theme initialization run. If recovery cannot finish, editing is paused and a
recovery download/retry screen is shown. No recovery record is created simply by
opening the app or exporting.

## Safe manual check

1. Use a separate browser profile and `npm run dev` so production data stays
   separate. Close other Taskly tabs for that origin.
2. Create a recognizable task, saved list, finished day, and theme selection.
   Export and retain the downloaded JSON outside browser storage.
3. Make a visible change. Choose Import data and select the backup. Cancel the
   confirmation and verify the change remains.
4. Repeat the import and confirm replacement. Verify tasks, calendar indicators,
   Lists, Finished Days, and theme after the automatic reload.
5. Download the recovery copy. Import it to recover the state from step 3.
6. Try invalid JSON, a file with `version: 2`, and a file missing one key. Each
   should show an error without changing the current data.

Run `npm test` for raw export, format/version validation, missing keys, null keys,
successful restore, storage write/removal failures, rollback, and interrupted
restore recovery. Tests use isolated in-memory storage, never browser storage.

## Limits

localStorage has no multi-key transactions. The journal allows recovery but cannot
make the seven writes atomic across tabs. Close other tabs before importing.
The recovery copy consumes additional storage; insufficient space prevents import
before replacement. If rollback also fails, keep the recovery record and download
it before clearing any browser data. Browser-data deletion removes both local data
and its recovery copy, so downloaded backups remain essential. The unchanged app
loaders may normalize malformed restored strings or use legacy/default fallbacks;
the backup and recovery files preserve the original raw values.
