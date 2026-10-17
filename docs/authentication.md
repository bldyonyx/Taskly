# Optional accounts (Phase 3)

Taskly works without an account. Open **Settings > Account** for **Log in** and
**Create account**. Signed-in users see their email, “Tasks saved on this
device.” and **Log out**. Login, signup and **Forgot password?** forms appear
inside Settings. Signup includes password confirmation.

## Configure a Firebase Web app

1. In the existing Firebase project, open Project settings > General > Your apps.
   Register a Web app if needed. Use its Web SDK configuration, not service-account
   credentials. This does not require setting up Hosting again.
2. Copy `.env.example` to `.env.local`. Fill in the four blank `VITE_FIREBASE_*`
   settings from that same Web app: API key, auth domain, project ID and app ID.
   `.env.local` is ignored by Git. Never add private keys, Admin SDK credentials or
   service-account JSON to any client environment variable.
3. In Authentication > Sign-in method, enable Email/Password. Review the project's
   password policy. Signup enforces a six-character minimum locally; Firebase
   validates the actual project policy and reports stronger-password requirements.
4. In Authentication > Settings > Authorized domains, review the domains used by
   the app and its authentication email actions. Include the Firebase Hosting
   domains and any custom production domains. For local testing, explicitly add
   `localhost` and/or `127.0.0.1` as needed; do not assume localhost is preauthorized.
   For GitHub Pages, the hostname is the Pages host, without `/Taskly/`.
5. Restart `npm run dev` after editing environment settings. Build with
   `npm run build` for Firebase Hosting or the existing GitHub mode for Pages.

Vite embeds `VITE_*` values in the client bundle at build time. Firebase's Web
configuration is client configuration, not a secret authentication credential.
Missing/partial configuration disables account operations with an explanation;
guest tasks, settings and backups continue working. Invalid configuration or
initialization errors similarly leave the local app usable.

References: [Firebase Web setup](https://firebase.google.com/docs/web/setup),
[Email/password authentication](https://firebase.google.com/docs/auth/web/password-auth),
[Managing users/password resets](https://firebase.google.com/docs/auth/web/manage-users),
[Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence),
[Vite environment variables](https://vite.dev/guide/env-and-mode.html).

## Deployment configuration required before enabling accounts

No Hosting, Vite base-path or GitHub Pages workflow configuration was changed.
The Firebase Hosting build must receive the four environment settings before Vite
runs. Hosting cannot supply them to an already-built bundle. The current GitHub
Pages workflow does not inject them: if accounts are also wanted there, its build
environment must provide those settings. Until configured and rebuilt, that build
will stay guest-only. No new URL routes or Hosting rewrites are needed.

## Session and data boundaries

`auth/config.js` validates the presence of Web settings. `auth/index.js` loads the
modular Firebase adapter only when configured. `auth/firebase.js` initializes only
Firebase App and Authentication. `auth/session.js` exposes loading, guest,
authenticated and unavailable states, pending operations and safe feedback.

The Auth observer is authoritative. The UI waits for its initial callback before
claiming a user is authenticated or signed out. Login/signup responses alone do
not update identity. Firebase's browser persistence restores sessions on reload
and its observer handles cross-tab identity changes. Restricted browser storage
can prevent persistence; guest task use remains independent of authentication.
Passwords are cleared from the form on submission and are not stored by Taskly.
Firebase manages its own session credentials. Taskly's view state exposes only
UID, email and email-verification status.

Changing accounts requires logout followed by login. No account event reads,
writes, clears, migrates or assigns ownership to the Taskly repository. The same
local tasks remain accessible to guest mode and every account using that browser
origin. Login is not a privacy lock for local tasks; use a separate browser profile
on a shared device if local data must be separated. Guest mode does not create a
Firebase anonymous account. Closing Settings does not cancel a request already
sent to Firebase; reopening Settings shows the current account state.

There are no Firestore imports, reads, writes, listeners, cloud-save indicators or
automatic guest imports. No import action is offered yet. A future phase must
introduce an explicitly confirmed guest import and a UID-scoped cloud repository
without reclassifying these browser-local records as account data. Account
deletion, verification-email sending and custom password-reset handlers are not
implemented. Reset emails use Firebase's hosted handler and generic confirmation
text so the UI does not disclose whether an email has an account.

## Verification

`npm test` includes session-state/configuration tests using an injected Auth adapter
and all existing backup/repository tests. No production users are created by tests.
`npm run build` checks the modular SDK integration.

To check a configured environment, use a separate browser profile and a disposable
test account in a non-production Firebase project. Export local data first:

1. With no environment configuration, verify tasks and backup controls work and
   Settings > Account explains that accounts are unavailable.
2. With configuration, verify the initial loading state, guest use, form validation,
   mismatched-password feedback, failed login and successful signup/login.
3. Reload and verify restored account identity alongside unchanged local tasks.
4. Log out, then use a second account. Local tasks, lists, finished days, theme and
   raw exports should remain identical. Test cross-tab sign-out as well.
5. Request a password reset and verify email delivery and the hosted reset flow.
6. Test keyboard navigation, Escape, mobile scrolling, slow requests and offline
   failures. Test backup import while signed in; it should refresh local data and
   retain the independent Firebase session.

Live Firebase configuration, authorized domains, Console password policy, email
delivery and production sign-in must be verified against the actual project.

## Dependency audit

Installing `firebase@13.0.0` currently produces five high-severity audit entries:
the Firebase/Firestore dependency chain includes an advisory against
`@grpc/grpc-js@1.9.16`, and the existing Vite/PostCSS tree includes an advisory
against `source-map-js@1.2.1`. Taskly imports only App/Auth; the Firestore/gRPC
packages are not used by the browser app. The audit's proposed Firebase downgrade
was not applied. Review compatible upstream fixes before production deployment
and again before adding Firestore; run `npm audit` for current details.
