import { NOTE_COLORS, THREAD_COLORS } from '../app/constants.js'
import { STORE, deleteRecords, getAllForProject, getRecord, putRecords } from './db.js'

/*
 * Workspace persistence. Asset records (spec §117) and connections (§118) reference each other
 * by ID; file blobs are stored separately so moving a card never rewrites its image data.
 * (A workspace always opens framed on its content, so no camera view is stored.)
 */

function createId(prefix) {
  const random = window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

export const createAssetId = () => createId('asset')
export const createFileId = () => createId('file')
export const createConnectionId = () => createId('thread')
export const createGroupId = () => createId('group')

const noteColorIds = new Set(NOTE_COLORS.map((color) => color.id))
const threadColorIds = new Set(THREAD_COLORS.map((color) => color.id))

export function normalizeAsset(record) {
  const now = new Date().toISOString()

  return {
    id: record.id,
    projectId: record.projectId,
    type: record.type,
    title: String(record.title ?? ''),
    filename: String(record.filename ?? ''),
    mimeType: String(record.mimeType ?? ''),
    fileId: record.fileId ?? null,
    // PDFs: a picture of the first page, for the card.
    previewId: record.previewId ?? null,
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    notes: String(record.notes ?? ''),
    x: Number(record.x) || 0,
    y: Number(record.y) || 0,
    z: Number(record.z) || 0,
    // Turn around the vertical axis, in degrees (angled panels and models).
    rotY: Number(record.rotY) || 0,
    width: Number(record.width) || 200,
    height: Number(record.height) || 200,
    // Models only: depth in workspace pixels, extra files (MTL, textures…), and appearance.
    depth: Number(record.depth) || 0,
    bundle: Array.isArray(record.bundle) ? record.bundle.filter((file) => file && file.fileId) : [],
    appearance: record.appearance === 'original' ? 'original' : 'white',
    // Notes only: one of NOTE_COLORS.
    color: noteColorIds.has(record.color) ? record.color : NOTE_COLORS[0].id,
    // Models only: facts about the stored light copy (triangles and bytes before / after).
    detail: record.detail && typeof record.detail === 'object' ? { ...record.detail } : null,
    groupId: record.groupId ?? null,
    source: String(record.source ?? ''),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  }
}

/*
 * A thread between two things (spec §118): it references them by ID, so the line is always
 * drawn from the data. An end can be an asset or a group.
 */
export function normalizeConnection(record) {
  const now = new Date().toISOString()

  return {
    id: record.id,
    projectId: record.projectId,
    sourceId: String(record.sourceId ?? ''),
    targetId: String(record.targetId ?? ''),
    type: 'relates',
    color: threadColorIds.has(record.color) ? record.color : THREAD_COLORS[0].id,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  }
}

// A soft group (spec §103–106): the assets that belong to it carry its id as groupId.
export function normalizeGroup(record) {
  const now = new Date().toISOString()

  return {
    id: record.id,
    projectId: record.projectId,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  }
}

export async function loadWorkspace(projectId) {
  const [assets, files, connections, groups] = await Promise.all([
    getAllForProject(STORE.assets, projectId),
    getAllForProject(STORE.files, projectId),
    getAllForProject(STORE.connections, projectId),
    getAllForProject(STORE.groups, projectId),
  ])

  // Deleting an asset keeps its blob so undo can restore it during the session.
  // Blobs no asset references any more are collected the next time the project opens.
  const referenced = new Set(assets.flatMap((asset) => [asset.fileId, asset.previewId, ...(asset.bundle || []).map((file) => file.fileId)]).filter(Boolean))
  const orphanIds = files.filter((file) => !referenced.has(file.id)).map((file) => file.id)

  if (orphanIds.length) {
    deleteRecords(STORE.files, orphanIds).catch(() => {})
  }

  return {
    assets: assets.map(normalizeAsset).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    files: new Map(files.filter((file) => referenced.has(file.id)).map((file) => [file.id, file])),
    connections: connections.map(normalizeConnection).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    groups: groups.map(normalizeGroup),
  }
}

// A stored file blob (undo brings deleted items back from these during the session).
export const loadFile = (id) => getRecord(STORE.files, id)

export const saveAssets = (records) => putRecords(STORE.assets, records)
export const removeAssets = (ids) => deleteRecords(STORE.assets, ids)
export const saveFile = (fileRecord) => putRecords(STORE.files, [fileRecord])
export const saveConnections = (records) => putRecords(STORE.connections, records)
export const removeConnections = (ids) => deleteRecords(STORE.connections, ids)
export const saveGroups = (records) => putRecords(STORE.groups, records)
export const removeGroups = (ids) => deleteRecords(STORE.groups, ids)
