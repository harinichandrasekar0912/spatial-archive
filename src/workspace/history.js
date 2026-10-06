import { HISTORY } from '../app/constants.js'

/*
 * Undo / redo (spec §114). Every change is recorded as the state of each record it touched,
 * before and after: assets, threads and groups (null where a record did not exist). Undo puts
 * the "before" states back, redo the "after" states; the workspace animates the difference.
 *
 * A change can carry a coalesce key (e.g. "nudge:<asset id>"): repeated key presses on the same
 * thing within HISTORY.coalesceMs become one step, keeping the very first "before".
 */

const KINDS = ['assets', 'connections', 'groups']

// A record as it is remembered: a deep copy, without its last-saved time.
export function remember(record) {
  if (!record) {
    return null
  }

  const copy = structuredClone(record)
  delete copy.updatedAt
  return copy
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function createHistory() {
  let past = []
  let future = []

  return {
    /*
     * change: { label, coalesceKey?, assets: Map id → before, connections: …, groups: … };
     * after(kind, id) reads a record's current state. Unchanged records are dropped; a change
     * that changed nothing is not recorded.
     */
    record(change, after) {
      const entry = { label: change.label, coalesceKey: change.coalesceKey || null, time: performance.now() }
      let changed = false

      KINDS.forEach((kind) => {
        entry[kind] = []
        ;(change[kind] || new Map()).forEach((before, id) => {
          const now = remember(after(kind, id))

          if (!same(before, now)) {
            entry[kind].push({ id, before, after: now })
            changed = true
          }
        })
      })

      if (!changed) {
        return null
      }

      const previous = past.at(-1)

      if (entry.coalesceKey && previous?.coalesceKey === entry.coalesceKey && entry.time - previous.time < HISTORY.coalesceMs) {
        KINDS.forEach((kind) => {
          entry[kind].forEach((step) => {
            const earlier = previous[kind].find((candidate) => candidate.id === step.id)

            if (earlier) {
              earlier.after = step.after
            } else {
              previous[kind].push(step)
            }
          })
        })
        previous.time = entry.time
        future = []
        return previous
      }

      past.push(entry)

      if (past.length > HISTORY.limit) {
        past.shift()
      }

      future = []
      return entry
    },

    // The entry to undo (moved onto the redo stack), or null.
    undo() {
      const entry = past.pop() || null

      if (entry) {
        future.push(entry)
      }

      return entry
    },

    redo() {
      const entry = future.pop() || null

      if (entry) {
        past.push(entry)
      }

      return entry
    },

    clear() {
      past = []
      future = []
    },
  }
}
