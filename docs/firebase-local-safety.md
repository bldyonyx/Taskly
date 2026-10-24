Phase 4.7.3 update: the isolated UI now uses the trusted demo project on ports
9100/8087 and a separate loopback command service. Browser initialization and
account theme writes are blocked. Follow the current [trusted integration guide](trusted-mutations.md)
for startup and validation; older isolated-port/legacy-writer instructions below
are historical. Normal development and production safeguards are unchanged.

# Local Firebase safeguards (Phase 4.6)

No production or staging Firestore synchronization is enabled. No environment
flag activates remote account repositories. The seven guest keys, backups,
recovery and account-switch isolation are unchanged.

## Modes and entry points

| Command / mode | Entry | Firebase behavior |
| --- | --- | --- |
| `npm run dev` / development | `src/main.js` | Guest/local only by default; optional production Auth requires both settings below. No Firestore. |
| `vite --mode production` or `github` (serve) | `src/main.js` | Still development: same explicit local Auth opt-in. |
| `npm run build` / production | `src/main.js` | Optional existing production Auth; missing/partial config leaves guest use available. Invalid complete config disables Auth. No Firestore. |
| `npm run build -- --mode github` | `src/main.js`, `/Taskly/` base | Same production behavior; existing Pages workflow unchanged. |
| `npm run dev:cloud-test` | `src/isolated/main.js` | Named demo app, fixed loopback Auth/Firestore; no production env or credentials. |
| `npm run build -- --mode cloud-test` | `src/main.js` | Normal local-data entry, Auth disabled; excludes isolated runtime. This is not an emulator UI build. |
| `npm run build -- --mode development` | `src/main.js` | Development Auth opt-in policy applies; use standard production build for release. |
| `npm run preview` | Already-built artifact | Keeps that artifact's policy; preview does not reconfigure embedded env. A production artifact can use production Auth. |
| staging / arbitrary custom modes | None | Vite refuses startup/build before any Firebase initialization. |

Only the four listed Vite mode names are accepted. Renaming a mode or using
`--mode staging` cannot inherit a production entry by accident.

## Environment conventions

Normal optional Auth uses the existing four `VITE_FIREBASE_*` web settings.
Project must be exactly `taskly-maya`, auth domain exactly its canonical
`firebaseapp.com` domain and app ID a Firebase web app ID. An existing default
app must match all four options before reuse. SDK initialization follows validation.
The key/app number's actual ownership cannot be verified offline: a human must
verify the complete web tuple in the approved project before deliberate Auth use.
These checks are routing safeguards, not backend access controls.

To intentionally contact production Authentication during local development,
manually set **both** `VITE_FIREBASE_ENV=production` and
`VITE_ALLOW_PRODUCTION_AUTH=true`, then restart Vite. This does not permit
Firestore. Without this opt-in, local guest use performs no Firebase operations.
Normal production/github builds retain optional Auth without these new settings
for compatibility. An explicitly supplied identity must still be `production`.

Vite loads `.env.local` in every mode and shell values take precedence. A file
name is not a boundary. The emulator entry exposes only `TASKLY_ISOLATED_*` and
reads none of those values for its fixed SDK configuration. No credentials are
needed for emulator tests. Never put service-account credentials into Vite env.

**Configuration recheck (2026-10-20):** the earlier inspection found a trailing
double quote in `VITE_FIREBASE_PROJECT_ID`. Final validation now finds no trailing
quote in either the raw field or Vite's parsed value; the project matches the
expected production ID and the complete tuple passes the local guard. No manual
correction is currently outstanding and this validation did not rewrite the file
or credentials. If the issue recurs, manually correct that variable's quoting;
safe example: `VITE_FIREBASE_PROJECT_ID=your-project-id` (no stray trailing quote).
The actual normal Auth guard additionally requires the exact production ID.
`.env.local` remains Git-ignored. Local validation does not verify credential
ownership remotely. Never copy these settings into emulator or staging files.

## Emulator startup and verification

Run `npm run emulators:cloud-test`, then `npm run dev:cloud-test`, and open
`http://127.0.0.1:5174` in a disposable profile. Project is fixed to
`demo-taskly-isolated`; Auth is `127.0.0.1:9099` and Firestore
`127.0.0.1:8085`. Configuration is checked before `initializeApp`. Both emulator
connections precede persistence, session observation and account operations.
Configuration failures show a startup alert. Unavailable emulators cause local
service errors; there is no live-service fallback. A loopback-only CSP remains.
Signup/login/reset accept only synthetic `@example.test` emails.

Use `npm run test:cloud-ui` with free ports for the full existing browser suite.
It blocks unexpected requests before transmission and checks seven-key equality,
account switching, conflicts and offline saves. Never stop an unrelated process
just to free a test port. `node scripts/check-local-browser.mjs` separately checks
normal development startup, Settings and reload with synthetic production-shaped
config and all external requests blocked; its profile/report is under `.firebase/`.
Set `TASKLY_TEST_BROWSER` if Chromium is installed elsewhere. Normal guest UI may
request Google Fonts; this is separate from Firebase access.

Run `npm test`; then:

```powershell
firebase.cmd emulators:exec --config firebase.json --only firestore --project demo-taskly-rules "npm run test:rules"
npm.cmd run build -- --outDir .firebase/phase46-normal-build
npm.cmd run build -- --mode cloud-test --outDir .firebase/phase46-cloud-test-build
node scripts/check-isolated-build.mjs .firebase/phase46-normal-build
node scripts/check-isolated-build.mjs .firebase/phase46-cloud-test-build
```

Builds reject isolated/staging modules in the actual bundler graph. Artifact
checks additionally scan for isolated/staging markers. Invalid-runtime unit tests
assert no new Firebase apps and zero fetch calls. Mocked Auth checks cover the
preserved subscribe/signup/login/logout/reset interface without live requests.
No live production login is needed or authorized for these checks.

## Deployment intent

`.firebaserc` has an explicit `production` alias and **no default**. Existing
emulator commands already pass demo project IDs. GitHub Pages CI is unchanged.
Firebase Hosting keeps its existing `firebase.json` and `dist` setup.

After separately approving a production Hosting deployment and reviewing a fresh
normal production `dist` build, the guarded command is:

```powershell
npm.cmd run deploy:firebase -- --project taskly-maya --only hosting --confirm-production taskly-maya
```

This command actually deploys: do not run it for validation. The wrapper accepts
only that exact argument sequence and invokes Firebase with explicit project,
config and Hosting scope. Missing intent, aliases, staging, rules, extra flags
and ambiguous targets are rejected before the CLI runs. Tests call only the pure
deployment planner. Bare `firebase deploy` no longer has a default project.
The wrapper cannot restrict a human invoking raw Firebase CLI with explicit flags,
global CLI credentials or Admin SDKs; IAM and review remain necessary. Any future
rules deployment needs a separately reviewed procedure and approval.

## Inactive staging contract

`scripts/staging-contract.mjs` is tooling-only and is excluded from normal builds.
It requires `TASKLY_STAGING_ENV=staging`, `TASKLY_STAGING_PROJECT_ID`,
`TASKLY_STAGING_API_KEY`, `TASKLY_STAGING_AUTH_DOMAIN` and
`TASKLY_STAGING_APP_ID`. Domain must match the dedicated non-production project;
production and demo IDs, missing identity and mixed settings fail closed.
`APPROVED_STAGING_PROJECT` is currently `null`; **every candidate is refused**.
`STAGING_WRITES_ENABLED` is a source constant `false`, with no env override.
The activation function always refuses; no staging entry or SDK initializer exists.

Before adding live staging, record explicit approval for project provisioning,
pin the exact project/web tuple in reviewed source, implement a separate named
app/entry and origin with pre-SDK validation, and enforce tester admission.
Complete the pending rules/security/bounds/UI matrix in the staging plan.
Approve remote configuration/Auth operations, rules deployment, Hosting and bounded
synthetic writes separately. Activating writes requires a reviewed implementation
and approval record describing project, operations and synthetic testers; a generic
flag is insufficient. Production sync, imports/migrations and destructive cleanup
remain separate future approvals. No such action was taken in Phase 4.6.
