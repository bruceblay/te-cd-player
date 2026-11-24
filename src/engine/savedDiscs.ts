import type { Compilation } from './compilation'

type SavedDisc = Compilation & { savedId: string }
export interface DiscListing { id: string; title: string }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bc1-discs', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('discs', { keyPath: 'savedId' }).createIndex('title', 'title')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveDisc(disc: Compilation): Promise<SavedDisc> {
  const value = { ...disc, title: disc.title.trim() || 'untitled', savedId: disc.savedId ?? crypto.randomUUID() }
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('discs', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      // Structured cloning stores the File bytes alongside the ordered track metadata.
      tx.objectStore('discs').put(value)
    })
    return value
  } finally {
    db.close()
  }
}

export async function listDiscs(): Promise<DiscListing[]> {
  const db = await database()
  try {
    return await new Promise<DiscListing[]>((resolve, reject) => {
      const rows: DiscListing[] = []
      const req = db.transaction('discs').objectStore('discs').index('title').openKeyCursor()
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve(rows)
        rows.push({ id: String(cursor.primaryKey), title: String(cursor.key) })
        cursor.continue()
      }
    })
  } finally {
    db.close()
  }
}

export async function openDisc(id: string): Promise<SavedDisc> {
  const db = await database()
  try {
    return await new Promise<SavedDisc>((resolve, reject) => {
      const req = db.transaction('discs').objectStore('discs').get(id)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => req.result ? resolve(req.result) : reject(new Error('disc missing'))
    })
  } finally {
    db.close()
  }
}

/** discs that ship with the app; their tracks are read from the link when picked */
export const BUILT_IN_DISCS: (DiscListing & { url: string; color: string })[] = [
  { id: 'builtin:oil-and-cotton', title: 'oil and cotton', url: 'https://www.youtube.com/playlist?list=PLFBFAAB01A2CF4DB6', color: '#ff5a1f' },
]
