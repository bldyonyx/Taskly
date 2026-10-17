# Firestore foundation (Phase 4.1)

For current lifecycle safeguards, test results and remaining activation blockers,
see [Phase 4.2 account integration](account-data-integration.md). The text below
records the original Phase 4.1 implementation and verification status.

This phase adds a dormant schema, repository and rules. Nothing in `main.js`,
Authentication, Settings or the local repository imports the Firestore foundation.
Guest and signed-in task data still live exclusively in localStorage. There is no
upload, migration, synchronization, background listener, UI change or deployment.

## Schema version 1

Every document has `schemaVersion: 1` and `ownerId: uid`. IDs in document fields
must match their path. All writes use exact expected field sets.

| Path beneath `users/{uid}` | Additional fields |
| --- | --- |
| User document itself | None; reserved schema/ownership marker |
| `days/{YYYY-MM-DD}` | `dateKey`, nullable `currentListId` |
| `days/{dateKey}/tasks/{taskId}` | `id`, `text`, `completed`, `order` |
| `savedLists/{listId}` | `id`, `name`, `createdAt`, `updatedAt`, `order` |
| `savedLists/{listId}/tasks/{taskId}` | `id`, `text`, `completed`, `order` |
| `finishedDays/{finishedId}` | `id`, `dateKey`, `date`, `createdAt`, `completedCount`, `totalCount`, `order` |
| `finishedDays/{finishedId}/tasks/{taskId}` | `id`, `text`, `completed`, `order` |
| `preferences/general` | `themeId` |
| `imports/{importId}` | `id`, `sourceId`, `backupHash`, `status`, `createdAt`, `completedAt` |

`order` is the original zero-based array index, including saved-list and
finished-day collection ordering. Firestore query/document-ID ordering is not the
application ordering; future consumers must sort by `order`. Existing IDs and task
completion are copied verbatim. Tasks in saved lists and finished days are separate
snapshot documents, not references to active tasks. The same task ID can appear in
different snapshots. Within one task collection, duplicate IDs are rejected.

Calendar indicators remain derived from nonempty day task collections and
finished-day `dateKey` values. `currentListId` refers to a saved list under the same
user; days with references but no active tasks can still have metadata documents.
Finished days keep their original timestamp strings as `date` and `createdAt` for
compatibility, but **calendar association always uses the explicit `dateKey`**.
No original ID or date key is regenerated and no text is trimmed.

`schema.js` exposes strict validators and the pure planning function
`mapLocalStateToDocuments(state, { uid, themeId, finishedDayDateKeys })`. It takes
explicit, caller-owned data only and returns relative document paths/data; it
never reads localStorage or writes anything. It does not produce import records.
It rejects invalid IDs, unsupported fields/types, duplicate sibling IDs, dangling
list references and inconsistent finished-day counts instead of repairing data.

For legacy finished days containing ISO timestamps, the caller must supply an
explicit mapping from finished-day ID to original local `YYYY-MM-DD` key, unless
the object already contains a `dateKey`. A date-only `date` can be used directly.
Conflicting keys are rejected. The mapper never derives calendar dates from a
timestamp in the importing device's timezone. Existing local loaders and models
remain unchanged; resolving historical timestamp-only dates requires review in a
future explicit import flow.

Task text is limited to 10,000 characters, list names to 200, and legacy timestamp
strings to 64. Nonnegative safe integers represent order and counts. Import IDs
and source IDs are supplied explicitly; `backupHash` is a lowercase SHA-256 hex
digest. Import status is `pending` with null `completedAt`, or `complete` with a
nonempty completion-time string. These records are future retry/deduplication
metadata, not proof of server-verified migration. No import UX or hash generation
is activated. Oversized or otherwise unsupported legacy data must be reviewed,
not truncated, before a later upload.

## Security model

`firestore.rules` grants access only where `request.auth.uid` matches the UID in
the document path. Guests have no authenticated identity and are denied. Known
collections have explicit rules, including every nested task collection. Unknown
collections and extra nesting fall through to a deny-all rule. There is no broad
recursive owner write grant. Owner-scoped reads and collection queries are allowed
within the planned collections; preference writes are restricted to `general`.

Creates and updates validate required/allowed fields, schema version, owner, IDs,
basic types, enum values, length limits and counts. Owner changes are rejected.
Saved-list creation time is immutable. Finished-day calendar key, original date
and creation time are immutable. Import source, hash and creation time are
immutable; a complete import cannot return to pending. Owners can delete their
own records. Server Admin credentials bypass client rules and must stay outside
client code; none are introduced here.

Rules check date-key month/day ranges; the client additionally checks actual month
lengths and leap years. Basic rules do not prove sibling order uniqueness,
cross-document completion counts, reference existence, parent existence, or an
atomic multi-document import. Documents can be created before their parents, and
deleting a parent does not recursively delete children. These lifecycle concerns
must be designed before synchronization, using deliberate batches/transactions
and cleanup. [Firestore field validation](https://firebase.google.com/docs/firestore/security/rules-fields),
[Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

No composite queries are implemented, so no custom indexes or
`firestore.indexes.json` are needed. `firebase.json` adds only the Firestore rules
reference; its existing Hosting object is unchanged. Future multi-field query
patterns may require a reviewed index configuration.

## Repository boundary

`repository.js` provides explicit document `read`, `write`, `remove`, collection
`subscribe` and `dispose` methods. All relative paths are allowlisted, rooted at
`users/{boundUid}`, and validated. There is no UID override per operation. Reads
and listener snapshots are validated before delivery. Writes are detached from
caller-owned objects and use full document replacement, not arbitrary field merges.

`firebase.js` provides an opt-in modular SDK adapter. A future caller must supply
the existing Firebase App and Auth session controller, await construction, and
deliberately invoke an operation. Construction waits for Firebase Auth readiness
and verifies the actual SDK user against the controller's UID. Firestore is only
initialized on the first explicit operation. Default memory caching is used; disk
persistence is not enabled. Explicit document reads use the server.

Repositories require resolved authenticated state without an auth operation in
progress. Pending logout, sign-out, unavailable auth, account switching or disposal
permanently invalidates a repository and stops its listeners. Returning to the same
UID requires a new repository. Results arriving after invalidation are rejected or
suppressed. The SDK identity is checked as well as the controller. There is no
guest-data fallback and no repository is constructed by the current app.

An operation already submitted to Firebase cannot be recalled by sign-out. SDK
writes may queue while offline; this phase does not implement pending-write
handling, conflict resolution or transactional multi-record changes. Those policies
and cache/session cleanup must be settled before connecting this adapter to UI
mutations. Security Rules remain the authoritative access check.

## Verification commands

From the Taskly root in PowerShell:

```powershell
npm.cmd test
npm.cmd run build
```

Unit tests cover mapping, stable dates under multiple timezones, schema validation,
duplicate/reference rejection, dormant construction, path isolation, stale reads,
listener cleanup and Auth boundaries. All previous tests remain included.

Rules tests use the existing Firebase SDK's emulator mock-user support, with no
additional npm dependencies. They must run against the real Firestore emulator;
unit tests do not substitute for rules compilation or evaluation. Prerequisites:
Firebase CLI, a supported Java runtime on PATH (use Java 21 for current tooling),
and initial network access for the emulator download. Then run:

```powershell
java -version
firebase.cmd emulators:exec --only firestore --project demo-taskly-rules "npm run test:rules"
```

Alternatively, in terminal 1:

```powershell
firebase.cmd emulators:start --only firestore --project demo-taskly-rules
```

And terminal 2:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-taskly-rules'
npm.cmd run test:rules
```

The suite refuses non-loopback endpoints and nonmatching project IDs. It clears
only the dedicated demo project's emulator database, seeds valid documents through
normal rules-protected clients, and checks owner access, guest/cross-user denial,
nested task validation, ownership forgery, bad types/fields, immutable dates,
import transitions and deny-by-default nesting. It is separate from `npm test` and
fails when invoked without an emulator. Close the emulator when finished.

In this environment the attempt failed with `Could not spawn java -version`
(`ENOENT`). Rules tests and rules compilation therefore remain **unverified** until
Java is available and the emulator suite passes. No Java or extra npm packages
were installed. [Emulator prerequisites](https://firebase.google.com/docs/emulator-suite/install_and_configure),
[Rules testing](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

## Manual deployment, after emulator tests pass

This work does not deploy rules. Use an explicit Firebase project ID, not an
implicit alias, and review/save the current Console rules before replacing them.
For a separate test project, substitute that project ID first and verify behavior.
The production-mode rules in the Console stay locked until you choose to deploy.

```powershell
firebase.cmd login
firebase.cmd projects:list
# Replace YOUR_FIREBASE_PROJECT_ID with the intended project's ID.
firebase.cmd deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

The scoped command deploys rules only; it does not deploy Hosting or upload task
documents. Do not use an unscoped `firebase deploy`. After deployment, inspect the
Firestore Rules tab in the intended project and use Rules Playground to verify
that anonymous access and another UID's document are denied, an owner's valid
task is allowed, and changing `ownerId` is rejected. Deploying these owner rules
allows valid clients to write even though the current Taskly app remains dormant.
For rollback, restore the saved rules text and deploy again with the same scoped
command. [Deploy Firestore rules](https://firebase.google.com/docs/firestore/security/get-started).

Before cloud synchronization: pass the emulator suite, resolve legacy finished-day
dates, define an explicit guest-import confirmation/retry policy, atomic write and
delete behavior, ordering/conflict resolution, pending-write/error UX, account
cache lifecycle, query indexes and dependency-audit findings documented in
`authentication.md`. None of these are silently enabled by this foundation.
