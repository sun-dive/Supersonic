/**
 * IndexedDB-backed file cache for embedded NFT file data.
 *
 * Stores files locally so they survive page reloads and can serve as
 * a pruning recovery mechanism if the genesis TX becomes unavailable.
 */

export interface CachedFile {
  hash: string
  mimeType: string
  fileName: string
  bytes: Uint8Array
}

const DB_NAME = 'mpt-files'
const STORE_NAME = 'files'
const DB_VERSION = 1

export class FileCache {
  private dbPromise: Promise<IDBDatabase>

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'hash' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async store(hash: string, data: { mimeType: string; fileName: string; bytes: Uint8Array }): Promise<void> {
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({ hash, ...data })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(hash: string): Promise<CachedFile | null> {
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(hash)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  }
}
