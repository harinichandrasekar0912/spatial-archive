/*
 * Minimal IndexedDB wrapper. Workspace assets, their file blobs, connections and groups live
 * here; project metadata stays in localStorage (spec §116). Every store is indexed by projectId.
 */

const DB_NAME = 'spatial-archive'
const DB_VERSION = 1

export const STORE = {
  assets: 'assets',
  files: 'files',
  connections: 'connections',
  groups: 'groups',
}

let databasePromise = null

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export function openDatabase() {
  if (databasePromise) {
    return databasePromise
  }

  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      Object.values(STORE).forEach((name) => {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: 'id' }).createIndex('projectId', 'projectId')
        }
      })
    }

    request.onsuccess = () => {
      const database = request.result
      // Another tab upgraded the schema: release this connection so the upgrade can finish.
      database.onversionchange = () => database.close()
      resolve(database)
    }

    request.onerror = () => reject(request.error)
  })

  databasePromise.catch(() => {
    databasePromise = null
  })

  return databasePromise
}

export async function getAllForProject(storeName, projectId) {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  return requestToPromise(transaction.objectStore(storeName).index('projectId').getAll(projectId))
}

export async function getRecord(storeName, id) {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  return requestToPromise(transaction.objectStore(storeName).get(id))
}

export async function putRecords(storeName, records) {
  if (!records.length) {
    return
  }

  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  records.forEach((record) => store.put(record))
  await transactionDone(transaction)
}

export async function deleteRecords(storeName, ids) {
  if (!ids.length) {
    return
  }

  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  ids.forEach((id) => store.delete(id))
  await transactionDone(transaction)
}
