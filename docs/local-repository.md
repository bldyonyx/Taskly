# Rendering and local persistence

`src/main.js` owns the current in-memory state and selected date. Its `render()`
function renders tasks, progress and the current-list label, then runs optional
visual animations. It never updates domain state or writes storage. Selecting a
date or opening a calendar, list or settings dialog does not persist data.

User mutation handlers explicitly update state and call persistence helpers before
rendering. `persistSelectedDateTasks()` saves either the active dated tasks or the
selected finished-day snapshot. Active task changes also save date-to-list
references so legacy references remain attached to the original date. List
mutations save lists/references; finished-day mutations save snapshots. Reordering
preserves the task array order. These are ordinary synchronous local operations,
not transactions.

`src/js/storage/repository.js` provides the application data boundary. It delegates
serialization and normalization to the existing loaders/savers, preserving all
original key names, formats and legacy fallback rules. Storage is injected through
a lazy provider, which also makes focused tests independent of browser storage.
Identical serialized values are not written again. There is no cached storage
baseline to become stale after a restore.

Loading state is read-only. Legacy tasks and current-list references still fall
back to today in memory; missing/invalid data uses the existing fallback rules.
Dangling list references are filtered in memory. Nothing is normalized back to
storage simply by opening the app. Compatible dated values are saved only as part
of explicit user mutations; legacy keys are retained.

Finishing a day saves the original completion snapshot, cleared active tasks and
cleared list reference before animation starts. Intermediate completion frames and
the final visual reset do not write anything. Normal and reduced-motion paths save
the same data. `applyTheme()` and `applySavedTheme()` only update presentation;
`selectTheme()` handles a user selection and explicitly saves the preference.

Phase 1 backup reads/restores raw storage independently of the repository.
`prepareLocalData()` still runs recovery before theme or repository reads. Import
still reloads the page, then normal read-only startup displays the restored data.

`npm test` covers the repository's read-only hydration, legacy fallbacks, task
ordering/completion, date references, lists, snapshots, duplicate-write avoidance,
theme rendering versus selection, failures, and compatibility with backup/recovery.
The Phase 1 tests continue to cover restore validation and rollback.

Before adding accounts, the next layer must define asynchronous loading/saving,
account ownership and isolation, pending writes/error reporting, and conflict
handling. The current repository deliberately remains local and synchronous.
Normal multi-key mutations are not atomic and ordinary save failures still
propagate to their caller; Phase 1's restore journal applies only to backup imports.
Cross-tab reconciliation and finished-day timezone semantics are unchanged.
