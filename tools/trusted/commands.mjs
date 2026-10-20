import { createHash } from 'node:crypto'
import { validDateKey, validId, validateDocument } from '../../src/js/firestore/schema.js'

export function requireThat(ok, code, message) {
  if (!ok) throw Object.assign(new Error(message), { trustedCode: code })
}
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key))
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function parseCommand(input) {
  requireThat(Buffer.byteLength(JSON.stringify(input) ?? '') <= 262144, 'limit', 'Request exceeds 256 KiB.')
  requireThat(exact(input, ['requestId', 'expectedRevision', 'type', 'payload']), 'invalid-input', 'Unexpected command fields; UID and aggregate metadata are never accepted.')
  requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.requestId)
    && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, 'invalid-input', 'Invalid request ID or revision.')
  const schemas = { replaceDay: ['dateKey', 'tasks', 'currentListId'], saveList: ['dateKey', 'id', 'name'],
    finishDay: ['dateKey', 'id'], deleteParent: ['collection', 'id'] }
  const fields = typeof input.type === 'string' && Object.hasOwn(schemas, input.type) ? schemas[input.type] : null
  requireThat(fields && exact(input.payload, fields), 'invalid-input', 'Unsupported command or payload.')
  const p = input.payload
  requireThat(input.type === 'deleteParent' ? ['days', 'savedLists', 'finishedDays'].includes(p.collection)
    && validId(p.id) && (p.collection !== 'days' || validDateKey(p.id)) : validDateKey(p.dateKey), 'invalid-input', 'Invalid parent.')
  if (['saveList', 'finishDay'].includes(input.type)) requireThat(validId(p.id), 'invalid-input', 'Invalid snapshot ID.')
  if (input.type === 'saveList') requireThat(typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 200, 'invalid-input', 'Invalid list name.')
  if (input.type === 'replaceDay') {
    requireThat(p.currentListId === null || validId(p.currentListId), 'invalid-input', 'Invalid reference.')
    requireThat(Array.isArray(p.tasks) && p.tasks.length <= 348 && new Set(p.tasks.map((t) => t?.id)).size === p.tasks.length
      && p.tasks.every((t) => exact(t, ['id', 'text', 'completed']) && validId(t.id)
        && typeof t.text === 'string' && t.text.length > 0 && t.text.length <= 10000 && typeof t.completed === 'boolean'), 'invalid-input', 'Invalid task snapshot.')
  }
  // Canonical field order: reordering JSON keys does not change request identity.
  return { requestId: input.requestId, expectedRevision: input.expectedRevision, type: input.type,
    payload: Object.fromEntries(fields.map((key) => [key, key === 'tasks'
      ? p.tasks.map(({ id, text, completed }) => ({ id, text, completed })) : p[key]])) }
}

export function verifyState(uid, state) {
  for (const [parent, { metadata, tasks }] of Object.entries(state)) {
    validateDocument(uid, parent, metadata)
    requireThat(new Set(tasks.map((t) => t.id)).size === tasks.length, 'integrity', 'Duplicate membership.')
    tasks.forEach((t, i) => {
      validateDocument(uid, `${parent}/tasks/${t.id}`, t)
      requireThat(t.order === i, 'integrity', 'Noncontiguous task order.')
    })
    if (parent.startsWith('days/')) requireThat(metadata.currentListId === null || state[`savedLists/${metadata.currentListId}`], 'integrity', 'Dangling list reference.')
    if (parent.startsWith('finishedDays/')) requireThat(metadata.totalCount === tasks.length
      && metadata.completedCount === tasks.filter((t) => t.completed).length, 'integrity', 'Incorrect archive counts.')
  }
}

export function planCommand(uid, before, command, now) {
  const state = structuredClone(before)
  const full = (data) => ({ schemaVersion: 1, ownerId: uid, ...data })
  const p = command.payload
  const dayPath = `days/${p.dateKey}`
  const day = state[dayPath]
  if (command.type === 'replaceDay') {
    requireThat(p.currentListId === null || state[`savedLists/${p.currentListId}`], 'not-found', 'Referenced Saved List does not exist.')
    state[dayPath] = { metadata: full({ dateKey: p.dateKey, currentListId: p.currentListId }),
      tasks: p.tasks.map((t, order) => full({ ...t, order })) }
  } else if (command.type === 'deleteParent') {
    const path = `${p.collection}/${p.id}`
    requireThat(state[path], 'not-found', 'Parent does not exist.')
    delete state[path]
    if (p.collection === 'savedLists') for (const [path, item] of Object.entries(state)) {
      if (path.startsWith('days/') && item.metadata.currentListId === p.id) item.metadata.currentListId = null
    }
  } else {
    requireThat(day && day.tasks.length > 0, 'not-found', 'Source day has no tasks.')
    const collection = command.type === 'saveList' ? 'savedLists' : 'finishedDays'
    const target = `${collection}/${p.id}`
    requireThat(!state[target], 'conflict', 'Snapshot already exists.')
    const order = 1 + Math.max(-1, ...Object.entries(state).filter(([path]) => path.startsWith(`${collection}/`)).map(([, item]) => item.metadata.order))
    requireThat(Number.isSafeInteger(order), 'limit', 'Snapshot order exhausted.')
    state[target] = { metadata: full(command.type === 'saveList'
      ? { id: p.id, name: p.name, createdAt: now, updatedAt: now, order }
      : { id: p.id, dateKey: p.dateKey, date: p.dateKey, createdAt: now, order,
        totalCount: day.tasks.length, completedCount: day.tasks.filter((t) => t.completed).length }), tasks: structuredClone(day.tasks) }
    if (command.type === 'saveList') day.metadata.currentListId = p.id
    else { day.tasks = []; day.metadata.currentListId = null }
  }
  verifyState(uid, state)
  return state
}

export function documentsFor(uid, revision, state) {
  const manifest = { schemaVersion: 1, ownerId: uid, revision, parents: {} }
  const docs = { 'lifecycle/state': manifest }
  for (const [parent, { metadata, tasks }] of Object.entries(state)) {
    manifest.parents[parent] = tasks.map((t) => t.id)
    docs[parent] = metadata
    for (const task of tasks) docs[`${parent}/tasks/${task.id}`] = task
  }
  try { validateDocument(uid, 'lifecycle/state', manifest) }
  catch { requireThat(false, 'limit', 'Account exceeds manifest bounds.') }
  requireThat(Buffer.byteLength(JSON.stringify(docs)) <= 4 * 1024 * 1024
    && Object.values(docs).every((d) => Buffer.byteLength(JSON.stringify(d)) <= 900 * 1024), 'limit', 'State exceeds conservative byte bounds.')
  return docs
}
