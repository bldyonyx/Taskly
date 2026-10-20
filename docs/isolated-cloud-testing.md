# Phase 4.4: isolated cloud UI testing

Phase 4.6 adds environment and CLI safeguards; see the current
[local Firebase developer guide](firebase-local-safety.md). Normal development
now defaults to guest-only and requires explicit opt-in for production Auth.
Emulator signup/login/reset require synthetic `@example.test` addresses.
The remaining Phase 4.4 text describes the original isolation workflow/history.

Production synchronization is still disabled. The normal `src/main.js`, Auth
bootstrap, seven guest keys, storage recovery and production cloud flag are
unchanged. No real account or production data was used. No rules or application
code were deployed, and no commit or push was made.

## Launch locally

Prerequisites: the existing npm dependencies, Firebase CLI on PATH and Java 21.
No additional npm dependency is required. Use synthetic accounts such as
`alice@example.test` and `bob@example.test`, with invented passwords.

In terminal 1, from the Taskly project root:

```powershell
npm.cmd run emulators:cloud-test
```

This is equivalent to:

```powershell
firebase.cmd emulators:start --config firebase.isolated.json --only auth,firestore --project demo-taskly-isolated
```

In terminal 2:

```powershell
npm.cmd run dev:cloud-test
```

Open **http://127.0.0.1:5174** in a fresh browser profile/private session. The
window title and banner say **ISOLATED TEST**. Auth connects only to
`127.0.0.1:9099`, Firestore only to `127.0.0.1:8085`, using the fixed
`demo-taskly-isolated` project. The emulator UI is disabled. Ports are fixed and
Vite refuses to silently select another port.

1. Guest mode uses the existing local repository on this test origin. Do not paste
   an existing backup or use real browser data for tests.
2. Open Settings and create a synthetic account. The task area clears while Auth
   resolves, then displays the empty/uninitialized account rather than guest tasks.
3. For a newly created, audited empty emulator account, click **Initialize audited
   empty emulator account**. Initialization is a deliberate test action, not an
   automatic import or startup write. Existing cloud parents block initialization.
4. Exercise account workflows, then log out. The guest workspace and its theme
   are restored from their own storage. Log in as the second test account to
   verify separation, and refresh while signed in to verify persistence.
5. Use **Reload account data** after a conflict or reconnect. It reloads only;
   it never retries a mutation. Re-enter an action only after reviewing the new
   authoritative view.

Stop both terminals with Ctrl+C. The manual emulator command does not export
state, so restarting it gives a fresh emulator database. Browser Auth persistence
can outlive the emulator; after a reset, use a fresh test profile or sign out and
create synthetic accounts again. Never clear the normal application's browser
storage as part of testing.

## Isolation and production build guarantees

`vite.config.js` selects the isolated entry **only** for a development server
explicitly started with `--mode cloud-test`. It rewrites the HTML entry to
`src/isolated/main.js`; the checked-in normal HTML still points to `src/main.js`.
There is no localStorage/query-string toggle and no environment flag that enables
production sync.

The source-level production flag remains `CLOUD_SYNC_ENABLED = false`. For every
build command, including `vite build --mode cloud-test`, the isolated flag is
false and the entry rewrite plugin is absent. The isolated files, demo credentials
and emulator endpoints are excluded from the production dependency graph. The
`scripts/check-isolated-build.mjs` artifact check verifies that exclusion.

The isolated runtime additionally rejects non-development mode, missing opt-in,
wrong mode and non-loopback hostnames before initializing Firebase. It creates a
dedicated named Firebase app with a dummy emulator API key; it never reuses the
default production app. Emulator connections are set before Auth persistence or
any operation. The test Vite environment does not expose ordinary
`VITE_FIREBASE_*` variables from `.env.local`. Missing emulators fail closed;
there is no production fallback.

A test-only Content Security Policy restricts backend connections to loopback
ports and same-origin resources. The existing external Google Fonts import is
removed by the development transform for this mode only; the normal stylesheet
is unchanged. Test controls use a small separate stylesheet and system font
fallbacks. The automated browser suite also intercepts requests and fails if the
page attempts a non-loopback request.

**Normal production startup still performs zero Firestore reads, writes or
listeners.** Optional production Auth retains its previous behavior. The isolated
runtime deliberately performs emulator reads after Auth resolves, and explicit
test actions perform emulator writes. There are no application cloud listeners
in the UI adapter; data refreshes only on context changes, confirmed writes and
the explicit reload action.

## UI state and mutation architecture

`src/isolated/controller.js` coordinates identity and asynchronous state without
depending on the DOM, storage or Firebase SDK. Guest callbacks and the account
factory are separate injected dependencies. A context generation increments on
each Auth readiness/identity transition. It synchronously clears tasks, calendar
markers, lists, archives, revision and theme before awaiting any new account.
Late factories are disposed and late reads/writes cannot publish into a newer
context, including when returning to the same UID. Pending logout clears the view
immediately. Guest storage never receives account state.

The isolated entry reuses Taskly's task renderer, Sortable, calendar, list dialogs,
Settings, themes and local repository. Rendered task callbacks and modal actions
are generation-bound; identity changes synchronously dismiss modals and dispose
their event handlers/subscriptions. Drag operations also capture their date and
revision. Dialogs receive detached list arrays, preventing their local UI mutations
from changing the confirmed store during a pending/failed write.

The test banner exposes these states:

| State | Behavior |
| --- | --- |
| Waiting/loading | Cleared context on Auth change; edits blocked until account reads complete |
| Saving | Last confirmed view retained; duplicate mutations blocked |
| Saved / confirmed | Displayed only after the mutation confirms and authoritative reload succeeds |
| Offline/unavailable | No write replay or local cloud outbox; reconnect and reload explicitly |
| Conflict detected | Displayed revision remains stale; editing blocked until explicit reload |
| Save failed / size limit | No automatic retry or partial fallback; reload to determine server state |
| Uninitialized | Separate explicit audited-empty-account initialization action |

If the server confirms a write but the subsequent read fails, the message says
the write was confirmed and asks for a reload, **not another write**. Submitted
requests cannot be canceled by logout, but their late acknowledgment cannot
report success into the next context.

Cloud task edit/create/complete/delete APIs now accept a displayed revision.
The isolated UI uses the atomic, revision-required `replaceDatedTasks` operation
for task changes, bulk actions, and copying templates/archives into an active day.
All ID/order and reference changes commit together. New active copies receive
new IDs intentionally, as in the existing local template-loading behavior;
editing, completing, reordering and archiving preserve their current IDs.

`saveListForDate` atomically saves a new list snapshot and selects its reference
for that date. Existing-list updates use revision-required snapshot replacement.
Finish Day and cascade operations use the Phase 4.3 APIs. Themes use separate,
targeted server-confirmed preference transactions and never guest theme storage.

Settings keeps its normal defaults. It accepts optional test-session, appearance
and backup hooks so the test entry can use the emulator identity/theme and hide
local import/export while an account or unresolved context is active. Guest
Settings retains local backup/recovery. No production Settings redesign occurred.

## Workflows actually executed

The browser runner launches installed Chromium in a new disposable profile under
ignored `.firebase/cloud-ui-{timestamp}`. It starts Vite, uses the real Auth and
Firestore emulators, drives the DOM and real Sortable pointer events through CDP,
and saves a JSON report and screenshot. It does not use personal browser profiles
or install a browser/package. Override browser discovery if necessary:

```powershell
$env:TASKLY_TEST_BROWSER = 'C:\path\to\chrome.exe'
npm.cmd run test:cloud-ui
```

Do not run a second emulator or dev server on the same ports. The runner requires
the exact demo project and loopback environment supplied by `emulators:exec`, and
uses only synthetic accounts/data.

Browser-executed checks cover:

- Guest restoration, empty account isolation, explicit initialization and no
  guest-data migration.
- Create, edit, complete, pointer-drag reorder and delete tasks.
- Save and load a Saved List with its dated reference.
- Save an account theme and restore tasks/theme/Auth after a browser refresh.
- Atomic Finish Day, viewing the Finished Days list, and selecting another
  calendar date.
- Two tabs with independent displayed revisions: a stale write produces a visible
  conflict and does not retry; explicit reload restores authoritative data.
- Browser offline save failure, no premature success, and no replay after
  reconnect/reload.
- Logout restores guest tasks; a second synthetic account starts empty; logging
  into the first account never shows the second account's tasks.
- All seven guest keys remain byte-for-byte identical through account workflows;
  no non-loopback request or browser runtime exception occurs.

Unit/controller tests additionally execute rapid account switches, stale factory/
read results, acknowledged-late writes, initial Auth waiting, displayed revision
handling, unconfirmed writes, size failures and explicit refresh. Existing
repository tests cover stale listener callbacks; this UI installs no such
listeners. Emulator tests exercise server rule denials, atomic rollback,
replacement/cascade and concurrent clients.

Browser checks do **not** claim full mobile/accessibility coverage, every theme,
all failure-injection paths, guest backup restore, or every Saved List/archive
editor/delete option. Those remain for later focused UI testing; the lifecycle
and unit tests cover the supported underlying operations.

## Blocked operations and remaining activation work

The Phase 4.3 bounds still apply: 350 indexed account documents, 400 old/new
transaction documents, and the manifest size bound. Errors block edits and never
split a lifecycle operation into partial batches. Large or untracked accounts
require a separate reconciliation/scaling design.

Cloud Finished Day editing/replacement remains disabled. Calendar-selected cloud
archives are read-only; select an unfinished date before loading a template or
archive copy into active tasks. The archive Edit action is disabled. Whole-account
deletion, legacy reconciliation and guest-data migration are not implemented.
Timestamp-only legacy dates must still use the explicit Phase 4.3 review strategy;
the test UI never guesses or repairs them.

Before real staging, finish the remaining UI matrix, validate the intended size
policy, and review lifecycle rules and initialization/reconciliation requirements.
No real staging project is needed for the current tests. If one is later approved,
perform these steps manually:

1. Create a **separate non-production Firebase project**, not `taskly-maya`, with
   Email/Password Auth and Firestore. Restrict its testers and use synthetic data.
2. Review and deploy the current lifecycle rules to that staging project only;
   the Phase 4.3 rules have still not been deployed to production.
3. Design a separate staging runtime/build gate with an explicit project allowlist
   and no production fallback. The emulator entry intentionally cannot be pointed
   at staging by changing `.env`.
4. Audit fresh staging accounts before explicit initialization. Test request
   failures, concurrent sessions, refresh, Auth transitions, bounds and server
   confirmation with the staging adapter before proposing production activation.

Production activation requires separate explicit approval, a reviewed deployment
plan, account-data audit/reconciliation where needed, and a decision about the
bounded lifecycle protocol. It is not authorized or performed by this phase.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/isolated/config.js`, `firebase.js` | Runtime guards, named demo app, fixed Auth/Firestore emulator connections |
| `src/isolated/controller.js` | Session generations, isolated hydration, confirmed mutations and error states |
| `src/isolated/main.js`, `test-mode.css` | Isolated UI entry reusing existing components; test-only banner |
| `src/js/data/account.js` | Displayed revision arguments and atomic day/list UI operations |
| `src/js/ui/account.js`, `modals.js` | Optional test hooks, immediate context dismissal, archive edit restriction |
| `vite.config.js`, `firebase.isolated.json`, `package.json` | Explicit test mode, loopback CSP/config and launch commands |
| `tests/isolated-controller.test.js`, `tests/account-data.test.js` | Controller isolation, revision/error behavior and atomic UI operations |
| `scripts/cloud-ui.mjs`, `check-isolated-build.mjs` | Real browser/emulator workflows and production artifact assertions |
| This guide and prior-phase documentation links | Launch instructions, exact coverage and remaining blockers |

No production Firestore rule change was needed in Phase 4.4.

## Exact verification results (2026-10-17)

- `npm.cmd test`: **68 tests passed, 0 failed**.
- `firebase.cmd emulators:exec --only firestore --project demo-taskly-rules "npm run test:rules"`:
  **15 tests passed, 0 failed** against the real local Firestore emulator.
- `npm.cmd run test:cloud-ui`: **20 browser workflow checks passed**, no browser
  runtime exceptions and no non-loopback page requests. This used real Auth and
  Firestore emulators and a disposable installed Chromium session.
- `npm.cmd run build`: succeeded; the preexisting >500 kB JavaScript chunk warning remains.
- `npm.cmd run build -- --mode cloud-test --outDir .firebase/production-cloud-test-build`:
  succeeded and still produced the normal production entry.
- `node scripts/check-isolated-build.mjs` and the same command targeting
  `.firebase/production-cloud-test-build`: **4/4 text artifacts passed** in each
  build; neither contains isolated credentials/entry/endpoints.
- `git diff --check`: passed.

The final browser report and inspected screenshot are in
`.firebase/cloud-ui-1792273189582/report.json` and `verified-ui.png`.
Emulator command output is in `.firebase/phase44-ui.log` and
`.firebase/phase44-rules.log`. These are ignored local test artifacts.
All emulator instances and test browser processes started by the completed
runner are stopped; no development server is intentionally left running.
