# Phase 4.8 operator review packet (2026-10-24)

This is local preparation, not authorization to provision, access remote Firebase,
deploy, enroll accounts or activate writes. Remote staging and production remain
**NO-GO**. All values in `tools/staging/environment.example.txt` are placeholders.
The source pin is null and the write switch is false. No deployment command,
service-account key, hosting target or executable remote fixture is supplied.

## Architecture and deployment prerequisites

Future browser: dedicated staging Auth app -> signed ID token -> HTTPS POST
`/mutate` -> Admin token verification and enabled-user check -> transactionally
read admission -> shared trusted core -> atomic commit/receipt -> confirmed
response -> authoritative browser reload. Browser Firestore access is read-only.
The four commands are `replaceDay`, `saveList`, `finishDay`, `deleteParent`.
Saved List replacement is an explicit `saveList` variant; archives cannot be edited.

`tools/staging/runtime.mjs` is a lazy factory, not a listening server or deployed
function. It initializes project-bound Admin Auth/Firestore with managed ADC only
after all configuration/activation gates pass. It never imports the emulator
service, dummy credential or network guard. The pure planner and injected
transaction core are shared. The framework-neutral `Request -> Response` handler
still needs an independently reviewed managed HTTPS hosting wrapper, packaging
and separate deployment/build targets. That wrapper must preserve the raw body
byte limit before JSON middleware, use a trusted canonical request URL, enforce
host/TLS and avoid trusting arbitrary forwarded headers. There is no Vite staging
mode or deployment route today.

Approve one new, initially empty project, a database location and one dedicated
web app. Record the empty database/descendant inventory and IAM inventory before
initialization. Never select `taskly-maya`, existing UIDs or an existing database.
The future static build must have a named staging Firebase app, dedicated
read-only UID-bound repository, session clearing, login/logout only, an exact CSP
and no production fallback. The dormant account adapter accepts these dependencies;
it does not supply a remote reader/Auth initialization or public signup UI today.
Normal, cloud-test production and Pages builds exclude staging, shared command
transport and server tools. Do not relax those boundaries to package the pilot.

## Identity, ingress and admission

Admin `verifyIdToken(token, true)` supplies signature/certificate and project
validation and revocation checking. Additional issuer, audience, UID/sub, expiry,
issued-at and authentication-time checks precede `getUser` existence/enabled checks.
UIDs, project IDs, owners and counts are never accepted in command JSON. Emulator
variables, mixed project routing and credential-file configuration are rejected.
No Admin credentials enter browser code. Local mock verifiers are test dependencies,
not runtime-selectable identities. The local RSA test uses a generated test key;
it does not exercise Google's certificates or Admin's real signature path.

HTTPS allows only the pinned origin and endpoint, JSON POST with an Authorization
bearer header, and a restricted OPTIONS preflight. Missing/null/wrong Origin is
rejected. An Origin header does not authenticate a caller: every POST still needs
the verified ID token and transactional admission. Cookie authentication is absent,
browser credentials are omitted, and redirects fail. Exact origin CORS has no
credential allowance. JSON plus bearer-header preflight prevents ordinary cross-site
form CSRF; XSS or token theft still requires normal browser security controls.
Errors contain only status/code/confirmed=false, never internal exception text.

Enroll exactly 2 or 3 named synthetic `@example.test` testers, recording approved
UIDs and an accountable operator. Auth creation does not grant admission. A future
separately approved operator process creates the empty lifecycle manifest and
`trusted/state` marker using create-only preconditions after the inventory, then
`stagingTesters/{uid}` with `enabled: true` and a Firestore Timestamp `expiresAt`
no more than one hour ahead. This process is not implemented for remote use.
Clients cannot read or write roster, control markers or receipts. No browser API
can initialize/adopt an account or extend access. Revocation sets enabled=false
or removes admission; expiry denies reads and commands, including receipt replay.
Re-enrollment requires operator review; never auto-renew. Keep operator and service
clocks synchronized. Already accepted work can commit across the expiry instant;
revocation is not rollback and published views may remain in browser memory until
logout/reload. Test those cutoff semantics remotely before pilot approval.

## Bounds and failure behavior

The configurable server aggregate cap is 1–50, default 50, including the lifecycle
manifest, parents and tasks. Admission, trusted marker and retained receipts are
service documents outside that aggregate count. All three parent collections and
children of present parents are transactionally queried with bounded limits;
their physical membership must match the manifest. Proposed full document count
is checked before any transaction writes. Replacement, server-copy snapshots and
Finish Day overflow reject atomically without deletion/truncation or receipts.
An operator-inserted orphan under a missing parent is still outside this inventory;
fresh-only custody and prohibition of other Admin writers are required.

Existing bounds remain: 256 KiB request, 350-document underlying schema ceiling,
400 old/new paths including conservative service overhead, 4 MiB serialized state,
900 KiB per document, existing manifest bound and 1,000 receipts/account. No unsafe
receipt eviction; reaching the limit stops new commands. Transactions retry at
most 3 attempts. In-process HTTP bounds are 4 concurrent POSTs, 120 attempted
authenticated-boundary POSTs/minute per process and 30/verified UID/minute, including
replays. The body read deadline is 10 seconds; the browser abort timer is 15 seconds.
Invalid-origin/method and preflight traffic require infrastructure throttling too.

These memory limits reset on restart and multiply across instances. Before any
exposure, the operator must approve and verify distributed edge/ingress rate
limits (including unauthenticated traffic), max instances, concurrency, request
size/read timeout, Auth lookup timeout, Firestore RPC deadlines and bounded function
execution. Proposed initial hosting settings: min instances 0, max instances 1,
concurrency 4, request deadline 30 seconds, subject to platform verification. Those
settings are proposals, not enforced by a deployed manifest. A caller timeout
cannot cancel an accepted database commit. Retrying preserves the exact ID/content/
revision and receipt; switching aborts fetch and suppresses old-session results.
Success UI requires commit confirmation and a successful authoritative reload.
Offline/uncertain intent stays in memory only; refresh loses it. Inspect server
state before creating new work after uncertain delivery or lost page state.

## Candidate rules and least privilege

`firestore.staging.rules` denies all browser writes and unknown access. Listed
account families are readable only by the owning, currently admitted UID, with
expiry at most an hour ahead. `firebase.staging.local.json` is an emulator test
configuration, not a Hosting/Functions deployment target. The existing trusted
candidate and canonical production configuration remain separate.

**Admin bypasses security rules.** Use one dedicated runtime identity with no
production permissions and no human credentials. Candidate custom permissions for
the pinned staging database: `datastore.databases.get` (transaction/rollback),
`datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`,
`datastore.entities.update`, `datastore.entities.delete`. Auth enabled/revocation
lookup needs `firebaseauth.users.get` in the staging project. Logging may require
`logging.logEntries.create` for the selected sink/runtime. Verify the exact SDK
RPCs and IAM conditions with allow/deny smoke tests and audit logs; this permission
set is a design, not a tested remote binding. No database/schema administration,
Auth account mutation, IAM mutation, deployment, Owner/Editor or production roles.

Firestore IAM does not provide document-path authorization equivalent to rules.
Database entity write permissions can also modify roster/control/receipt paths;
the service has no enrollment API, but a compromised privileged identity can
bypass this. “Operator-managed roster” means clients and service code cannot
manage it; it does not claim a per-document IAM denial against the runtime.
Restrict impersonation, deployment and access to that identity, audit privileged
changes, and keep other Admin writers absent. If hard path-level IAM isolation of
admission is required, approve a separately isolated policy store and design before
deploying. A database-scoped IAM condition must be verified on real RPC resources;
project-only grants must never reach production. Deployer, runtime and enrollment/
cleanup operator identities need separate duties and reviewed permissions.

## Operator gates and runbook

1. **Approve the review packet:** project/web/origin/endpoint tuple, region, 2–3
   testers, command scope, cost envelope, IAM design, shutdown owner and retention.
   Check Firebase Auth, Firestore, static Hosting and the selected managed HTTPS
   compute product. Do not enable Storage, Analytics or unrelated services.
2. **Approve provisioning separately:** create the empty project/products, enable
   only required Auth providers, set exact authorized staging domains, remove
   unnecessary domains, record quotas and verify synthetic identity provisioning.
   UI signup removal is not a backend account-creation restriction: unlisted
   accounts must have zero account-data access. Confirm backend signup controls
   available for the selected Auth product rather than assuming they exist.
3. **Approve the cost and privilege setup:** verify plan, region/product quotas,
   compute/build/artifact/logging/egress costs and budget alerts. Alerts are not a
   hard cap. Configure admission/edge/instance limits and test shutdown. Use managed
   runtime ADC; no downloaded JSON keys, browser secrets or source-control secrets.
   Any necessary future secret belongs in approved Secret Manager with access
   limited to the runtime, version/rotation owner and audited access.
4. **Approve source pin/build/deployment:** review the exact full tuple and explicit
   activation changes, host wrapper and separate manifests/artifacts. Deploy only
   reviewed deny-client-write rules and the pinned HTTPS service/static artifact.
   Review the diff/checks without modifying normal deployment targets. Deployment
   is not approval to enroll accounts or enable synthetic mutations.
5. **Approve enrollment and bounded remote smoke tests:** operator creates only
   audited fresh UIDs/state/admission, then run signed-token wrong-project/expired/
   revoked/disabled cases, two-account isolation, direct-write attempts, all four
   commands, exact 50/overflow, stale revision, receipt replay, expiry/revocation,
   lost acknowledgment, actual timeout and shutdown. Confirm effective IAM denies
   production, client writes and unauthorized operators. No real data/accounts.
6. **Approve pilot GO separately:** assign an active operator and expiry window.
   No migration, whole-account deletion, archive editing, preferences writes or
   production synchronization. Stop immediately on an integrity or isolation failure.

Log structured request correlation ID, deployment/config version, result code,
latency, replay and revision where permitted; use a stable pseudonymous UID hash
only when needed. Never log tokens, authorization headers, task text, raw bodies,
credentials or internal error strings. Restrict logs, enable relevant Cloud Audit
Logs/Data Access after cost review, record admission/IAM/operator changes, alert on
denials/conflicts/limits/5xx and unexpected privileged writes. Verify logging failure
policy and audit coverage before exposure. Current adapter sanitizes responses;
deployed logging/sinks/alerts are not implemented or remotely tested.

Emergency shutdown: block command ingress and revoke all admission; revoke runtime
write permission if needed. Stop serving the staging UI, disable testers/revoke
sessions, allow accepted transactions to settle, then approve a diagnostic read
to verify quiescence and retain receipts/evidence. Never reopen direct writes.
Rollback serves the last reviewed artifact only after reviewing state and receipts;
disable activation first and re-run the smoke matrix before resuming. Production
and guest data are outside every rollback operation.

Proposed synthetic data/log retention is 7 days after the pilot, subject to operator
approval and incident holds. Expiry is not deletion. Cleanup needs separate explicit
approval, a full descendant inventory (including missing-parent orphans), removal
of receipts/control/admission and Auth identities, and verification of completion;
deleting a Firestore parent alone does not remove descendants. No remote cleanup
tool, scheduled deletion or browser whole-account deletion is supplied.

## Primary references checked for this preparation

Checked public documentation on 2026-10-24; operators must recheck before spending
or deployment. Firebase's pricing table places Cloud Functions in Blaze with
usage-based charges beyond applicable allowances; do not treat the pilot as free.
Firestore/Auth/Hosting quotas and charges depend on the chosen product/options.

- [Firebase pricing](https://firebase.google.com/pricing)
- [Admin token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Function scaling and runtime controls](https://firebase.google.com/docs/functions/manage-functions)
- [Firestore IAM RPC permissions](https://cloud.google.com/firestore/native/docs/security/iam)
- [Auth IAM roles and permissions](https://cloud.google.com/identity-platform/docs/access-control)

No project, service identity, account, IAM binding, secret, rule, function, host or
remote data was created, read, changed or deployed during this preparation.
