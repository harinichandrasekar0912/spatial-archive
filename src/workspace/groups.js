import { GROUP } from '../app/constants.js'

/*
 * Proximity grouping (spec §103–106): "proximity = belongs together".
 *
 * Grouping is decided when something is put down, never while it is being dragged:
 *   1. An item put down beyond GROUP.leaveGap of every other member leaves its group.
 *   2. An item without a group joins its nearest neighbour within GROUP.joinGap: that
 *      neighbour's group, or a new group of the two.
 *   3. Ungrouped things it now sits beside join its group too.
 *   4. A group that has come apart splits (its largest part keeps the group); a group with
 *      fewer than two members dissolves.
 * Two groups are never merged automatically: that is for the person arranging them.
 *
 * Boxes are axis-aligned extents in world units: { x, y, z, hx, hy, hz }.
 */

export function gapBetween(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - a.hx - b.hx)
  const dy = Math.max(0, Math.abs(a.y - b.y) - a.hy - b.hy)
  const dz = Math.max(0, Math.abs(a.z - b.z) - a.hz - b.hz)
  return Math.hypot(dx, dy, dz)
}

const near = (a, b, limit) => gapBetween(a.box, b.box) <= limit

// Working copy of every item's group, with the rules above as operations on it.
function createSession(entries, createGroupId) {
  const state = new Map(entries.map((entry) => [entry.id, { ...entry, groupId: entry.groupId || null }]))
  const membersOf = (groupId) => [...state.values()].filter((entry) => entry.groupId === groupId)

  function connectedParts(members) {
    const parts = []
    const seen = new Set()

    members.forEach((start) => {
      if (seen.has(start.id)) {
        return
      }

      const part = []
      const queue = [start]
      seen.add(start.id)

      while (queue.length) {
        const current = queue.shift()
        part.push(current)

        members.forEach((other) => {
          if (!seen.has(other.id) && near(current, other, GROUP.leaveGap)) {
            seen.add(other.id)
            queue.push(other)
          }
        })
      }

      parts.push(part)
    })

    return parts.sort((a, b) => b.length - a.length)
  }

  return {
    state,
    membersOf,

    // Rule 4.
    settle(groupId) {
      const members = membersOf(groupId)

      if (members.length < 2) {
        members.forEach((member) => {
          member.groupId = null
        })
        return
      }

      connectedParts(members)
        .slice(1)
        .forEach((part) => {
          const nextId = part.length > 1 ? createGroupId() : null
          part.forEach((member) => {
            member.groupId = nextId
          })
        })
    },

    changes() {
      const changes = new Map()

      entries.forEach((entry) => {
        const next = state.get(entry.id).groupId

        if (next !== (entry.groupId || null)) {
          changes.set(entry.id, next)
        }
      })

      return changes
    },
  }
}

/*
 * entries: [{ id, box, groupId }] for every item in the workspace; movedIds: the items just put
 * down. Returns the new groupId of every item whose group changed (Map id → groupId | null).
 */
export function regroup(entries, movedIds, { createGroupId }) {
  const session = createSession(entries, createGroupId)
  const touched = new Set()

  movedIds.forEach((id) => {
    const moved = session.state.get(id)

    if (!moved) {
      return
    }

    // 1. Still beside a member of its group?
    if (moved.groupId) {
      const groupId = moved.groupId
      touched.add(groupId)
      const mates = session.membersOf(groupId).filter((member) => member.id !== id)

      if (!mates.some((mate) => near(moved, mate, GROUP.leaveGap))) {
        moved.groupId = null
      }
    }

    const neighbours = [...session.state.values()]
      .filter((other) => other.id !== id && near(moved, other, GROUP.joinGap))
      .sort((a, b) => gapBetween(moved.box, a.box) - gapBetween(moved.box, b.box))

    // 2. Join the nearest neighbour.
    if (!moved.groupId && neighbours.length) {
      const nearest = neighbours[0]

      if (!nearest.groupId) {
        nearest.groupId = createGroupId()
      }

      moved.groupId = nearest.groupId
    }

    // 3. Bring ungrouped neighbours in.
    if (moved.groupId) {
      touched.add(moved.groupId)
      neighbours.forEach((neighbour) => {
        if (!neighbour.groupId) {
          neighbour.groupId = moved.groupId
        }
      })
    }
  })

  touched.forEach((groupId) => session.settle(groupId))
  return session.changes()
}

// After items have left the workspace: the given groups may have come apart (rule 4).
export function settleGroups(entries, groupIds, { createGroupId }) {
  const session = createSession(entries, createGroupId)
  groupIds.forEach((groupId) => session.settle(groupId))
  return session.changes()
}
