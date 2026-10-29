# Phase 4.9 — dormant Spark read-only staging (2026-10-29)

Local preparation only. Remote staging remains NO-GO. This document supersedes
prior plans for activating a paid runtime or staging writes. The trusted service,
revision/idempotency logic, emulator integration and HTTPS adapter remain intact.
Spark testing is **not full remote synchronization testing**.

## Environment audit

Ubuntu WSL2 workspace: `~/projects/Taskly`; clean Git worktree at start.
Node v24.21.0, npm 11.19.0. All package dependencies resolve (`npm ls --depth=0`),
including Vite 8.2.2, Firebase 13.0.0 and firebase-admin 14.5.0.
Firebase CLI 15.31.0 resolves through the Windows npm directory on `/mnt/c`.
Its version probe printed the version but exited 2 after update/configstore errors;
it also attempted the public Firebase CLI metadata endpoint (not project data).
Subsequent emulator calls suppress update checks. Java is absent. The emulator
cache contains only a Realtime Database JAR; no Firestore JAR was found.
Neither a Linux Chromium executable nor `TASKLY_TEST_BROWSER` is configured.
`.env.local` is absent. No credentials were copied, read or changed.

Existing scripts cover unit/HTTPS/rules/trusted/browser tests, three Vite build
modes and demo emulators. New fixture generation: `node tools/fixtures/spark.mjs`.
The existing browser harnesses require `TASKLY_TEST_BROWSER` and the cloud harness
requires the demo Auth/Firestore environment supplied by `emulators:exec`.

Safe manual setup, outside this preparation task:

1. Install Java 21+ and a Linux Firebase CLI compatible with Node 24 using your
   normal package-management process. Prefer Linux executables over `/mnt/c`.
   Cache the Firestore/Auth emulators; downloads need internet access. Do not
   authenticate the CLI to production to run demo emulators.
2. Install a Linux Chromium browser and set `TASKLY_TEST_BROWSER` to its absolute
   executable path. The harness uses a disposable profile and blocks remote page
   requests; do not point it at a personal browser profile.
3. Guest development needs no `.env.local`. For production Auth, only manually
   enter public web config following `.env.example` after separate authorization.
   Do not copy Windows credentials, use ADC or run `firebase login` for local tests.
4. Generate the ignored admission candidate with `node scripts/staging-admission.mjs`.
   Run all emulators with explicit `demo-*` IDs and loopback endpoints.

## Read-only architecture

`src/staging/read-only.js` defines a separate public-web contract:
`TASKLY_STAGING_ENV=staging`, `PROJECT_ID`, `AUTH_DOMAIN`, `API_KEY`, `APP_ID`,
and `ORIGIN`, all with the `TASKLY_STAGING_` prefix. There is no mutation endpoint.
Never place these settings in ordinary `.env.local` or a production CI build.
The read-only source approval is null. No environment flag can activate it.
Vite still rejects all staging modes, including `staging-read-only`; there is no
Hosting manifest, deploy script or enabled dev/build target for this entry.
Activation requires a future reviewed source pin AND separate packaging work.
Normal, cloud-test build and Pages artifacts exclude the entire staging tree.

The dormant runtime uses a separate named app, refuses any existing Firebase app,
uses real Firebase email/password sign-in (no unsigned tokens or emulator bypass),
and stores Auth only in memory. No signup/reset, service credentials, mutation
transport, default project fallback or automatic document creation exists.
Firestore reads use server-only SDK methods under the authenticated UID and check
that identity again after completion. Disposal/session changes suppress stale
results. The limited viewer reads up to 50 day records, clears output on account
changes and uses textContent for data. It is deliberately not the full task UI:
login/logout/manual reload only, prominent READ ONLY notice and disabled controls
for task changes, Finish Day, lists, themes and imports. It never reads or writes
any of the seven guest localStorage keys; no migration path is imported.

Firestore Security Rules, rather than UI controls, enforce admission and read
ownership. `firestore.staging.rules` denies every browser write, admission access,
service internals, unknown families and unsupported singleton IDs. Only admitted
owners may read account roots, supported parents/tasks, `lifecycle/state` and
`preferences/general`. Admission must be enabled, unexpired and no more than one
hour ahead. Revocation applies on the next server read; already rendered data
cannot be remotely erased. Admin bypass is not a client authorization mechanism.
Candidate rules remain local and undeployed.

## Fixtures and enrollment

`node tools/fixtures/spark.mjs > /tmp/taskly-synthetic.json` deterministically emits
five schema-valid documents: synthetic root, day, task, theme and revision-zero
manifest with exact task membership. No SDK, credential discovery, guest reads or
upload code is present. Test with `node --test --test-isolation=none tests/spark-staging.test.js`.
No orphan descendants or dangling list references are generated. This is a fresh
read-only fixture, not an adoption/repair tool or a trusted-service initialization.

Future manual enrollment requires explicit approval for a separate Spark project,
2–3 synthetic accounts and each roster/data write. Initially deploy deny-all rules
only after deployment approval. Manually create tester identities with invented
information and controlled test credentials; do not send email to invented domains.
Record the actual UIDs and an exact staging-only inventory. Review locally generated
fixtures with those UIDs and use a separately reviewed operator procedure to seed
only fresh accounts. No automatic uploader is supplied. Admission timestamps must
be Firestore timestamps, not JSON strings, with at most a one-hour lifetime.
Client signup cannot grant admission. Console/Auth signup controls should be
reviewed; the roster remains the authorization boundary.

## Free scope and safeguards

Firebase's [Spark plan](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
needs no billing account for the supported scope. Use email/password Auth,
Firestore Standard and optionally **static Firebase Hosting**, not App Hosting.
No Functions, Cloud Run, Extensions, SMS/phone Auth, Storage or paid integrations.
Do not link Cloud Billing: that upgrades the project to Blaze. Never upgrade to
resolve a quota failure; stop testing instead. Budget alerts are not spending caps.
Policies can change: Spark is not an absolute guarantee about future billing rules.

Reverify [official pricing](https://firebase.google.com/pricing) before any activation.
At review: Firestore Standard 1 GiB storage, 50,000 reads/day, 20,000 writes/day,
20,000 deletes/day and 10 GiB/month egress. Static Hosting: 10 GB storage and
360 MB/day transfer. Verify Auth provider/account-creation/sign-in limits,
Identity Platform status, Firestore free-database eligibility, rules-dependent
read charges and quota reset behavior. Use a tiny fixture, manual reloads, no
listeners/polling and a daily usage review. These quotas are ceilings, not targets.

Remote free test scope, after approval: actual signed Auth sessions, allowed owner
reads, denied cross-UID/anonymous reads, absent/disabled/expired admission, denied
client writes and unsupported paths, and optional static Hosting isolation.
Service mutation/revision/idempotency/conflict/offline/retry tests remain local
emulator tests. Actual Google token verification, deployed IAM, TLS and quotas are
not established by mocked or emulator tests. Spark does not host this trusted
mutation runtime; do not replace it with direct browser writes.

Approval checkpoints:

1. Approve separate project identity, Spark/no billing, products and operator access
   before creating anything. Never select `taskly-maya`.
2. Approve exact web tuple/origin, source pin, separate Vite packaging, restrictive
   rules, artifact audit and optional Hosting before any build activation/deployment.
3. Approve synthetic identities, fresh fixture inventory, roster and test matrix
   before account creation, remote access or operator writes.
4. Approve cleanup inventory before deletions. No write pilot or production sync
   approval is implied by any read-only checkpoint.

Proposed retention is seven days or less. Cleanup must enumerate task descendants,
parents, manifest/preferences/root and roster explicitly, verify no leftovers,
then delete synthetic Auth identities; deleting parents or Auth does not cascade.
Only the exact approved staging inventory may be removed. No cleanup runs here.
Emergency shutdown: stop distributing the viewer, revoke admission, deploy reviewed
deny-all staging rules and disable/revoke tester sessions as separately authorized.
Withdraw the staging host if used. Client flags alone cannot revoke shipped copies.
Preserve a small synthetic incident record and inspect usage; do not enable billing.

## Validation in this WSL environment

Logs are in `/tmp/taskly-49-*.log` (ephemeral local files).

| Check | Result |
| --- | --- |
| `npm test` | Exit 0; Node reports 13 file-level passes only in this environment. |
| `node --test --test-isolation=none` | **108 individual passes**, zero failures/skips. |
| `npm run test:https` | Exit 0; two file-level passes. |
| Same HTTPS/client files with `--test-isolation=none` | **14 individual passes**, zero failures/skips (also included in 108). |
| Canonical emulator attempt | Failed before startup: cannot spawn `java -version`. No rules tests executed. |
| New Spark rules emulator launch | Bounded 15-second CLI launch timed out (exit 124), with no test output. |
| Admission, trusted service and staging candidate service suite | Blocked by missing Java/Firestore emulator prerequisite; not executed. |
| Local normal browser check | Exit 1: set `TASKLY_TEST_BROWSER`; no browser launched. |
| Cloud browser check | Exit 1: missing demo environment; browser is also absent. |
| Production, cloud-test, github builds | All exit 0; existing >500 kB chunk warning only. |
| Artifact isolation | 4 files per build, **12 passed**; module graph guards also passed. |
| `git diff --check` | Passed. |

New unit assertions cover dormant activation before SDK initialization, production
and missing config rejection, mode rejection, absence of write surface/guest access,
UID scoping and owner validation, stale session suppression, fixture consistency
and disabled UI source. These do not substitute for actual browser execution.
`tests/emulator/spark.mjs` adds the candidate-rules admission/UID/write/path matrix;
it is prepared but unverified until local emulators work.

After environment repair, run the canonical suite with `firebase.isolated.json`
and `demo-taskly-rules`; admission with `firebase.admission.local.json`, the same
project and `TASKLY_TEST_ADMISSION=1`; trusted with `firebase.trusted.local.json`
and `demo-taskly-trusted`. Run trusted and Spark suites separately against
`firebase.staging.local.json` with `demo-taskly-trusted`. Use
`node --test --test-isolation=none tests/emulator/<suite>.mjs` as the emulators:exec
child command. Run `npm run test:cloud-ui` and the normal browser harness with a
Linux browser. These remain local demo tests, not authorization for remote access.

No Firebase project, real account or resource was created; no remote Firebase
project data was accessed or modified; no deployment, billing, migration, credential
change, commit or push occurred. Only official public documentation and the CLI's
public metadata probe used remote Firebase-related URLs. Next step: repair local
Java/emulator/browser prerequisites and complete the blocked local checks, then
review this packet before requesting any remote setup approval.
