// Explicit local operator tool, never exposed as an HTTP command.
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Firestore, Timestamp } from 'firebase-admin/firestore'
import { prepareLocalRuntime, PROJECT, FIRESTORE_HOST } from './config.mjs'

prepareLocalRuntime()
const email = process.argv[2]
if (!/^[^\s@]+@example\.test$/.test(email ?? '')) throw new Error('Synthetic email required.')
const app = initializeApp({ projectId: PROJECT, credential: { getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }) } })
const db = new Firestore({ projectId: PROJECT, host: FIRESTORE_HOST, ssl: false })
try {
  const user = await getAuth(app).getUserByEmail(email)
  // Only newly-created demo identities can be initialized; no adoption or repair.
  if (Date.now() - Date.parse(user.metadata.creationTime) > 300000) throw new Error('Fresh test identity required (under five minutes).')
  const root = db.doc(`users/${user.uid}`)
  await db.runTransaction(async (tx) => {
    for (const family of ['days', 'savedLists', 'finishedDays', 'lifecycle', 'trusted', 'mutationReceipts', 'preferences', 'imports']) {
      if (!(await tx.get(root.collection(family).limit(1))).empty) throw new Error('Existing account: adoption is forbidden.')
    }
    tx.create(root.collection('lifecycle').doc('state'), { schemaVersion: 1, ownerId: user.uid, revision: 0, parents: {} })
    tx.create(root.collection('trusted').doc('state'), { version: 1, requestCount: 0 })
    tx.create(db.doc(`stagingTesters/${user.uid}`), { enabled: true, expiresAt: Timestamp.fromMillis(Date.now() + 3600000) })
  })
  console.log('Fresh synthetic trusted fixture initialized; admission expires in one hour.')
} finally { await db.terminate(); await deleteApp(app) }
