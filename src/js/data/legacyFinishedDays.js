import { validDateKey, validId } from '../firestore/schema.js'
import { requireLifecycle as check } from './lifecycle.js'

// Caller-owned records only; never scans localStorage or writes reviewed results.
export function inspectFinishedDayDates(records) {
  check(Array.isArray(records), 'invalid-input', 'Expected finished-day records.')
  return records.map((record) => {
    const key = record?.dateKey
    const dateOnly = validDateKey(record?.date)
    const stable = validDateKey(key) && (!dateOnly || record.date === key)
    let status = stable || (key === undefined && dateOnly) ? 'resolved' : 'invalid'
    if (key === undefined && typeof record?.date === 'string' && !dateOnly
      && /^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(record.date)
      && validDateKey(record.date.slice(0, 10)) && Number.isFinite(Date.parse(record.date))) status = 'needs-review'
    return { id: record?.id, originalDate: record?.date, status,
      dateKey: stable ? key : status === 'resolved' ? record.date : null }
  })
}

export function resolveFinishedDayDates(records, decisions) {
  const review = inspectFinishedDayDates(records)
  check(records.every((record) => record && validId(record.id))
    && Array.isArray(decisions) && decisions.every((decision) => decision && validId(decision.id))
    && new Set(records.map((record) => record.id)).size === records.length
    && new Set(decisions.map((item) => item.id)).size === decisions.length, 'invalid-input', 'Duplicate or invalid review IDs.')
  for (const decision of decisions) {
    const entry = review.find((item) => item.id === decision.id)
    check(entry?.status === 'needs-review' && decision.reviewed === true
      && decision.originalDate === entry.originalDate && validDateKey(decision.dateKey)
      && validId(decision.id), 'ambiguous-date', 'Resolution must explicitly confirm an unchanged timestamp-only record and original local date.')
  }
  return records.map((record, index) => {
    const entry = review[index]
    const decision = decisions.find((item) => item.id === record.id)
    check(entry.status === 'resolved' || decision, 'ambiguous-date', 'Every ambiguous or invalid record requires review; invalid records cannot be auto-repaired.')
    return { ...structuredClone(record), dateKey: decision?.dateKey ?? entry.dateKey }
  })
}
