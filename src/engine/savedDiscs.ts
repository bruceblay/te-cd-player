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
      req.onsuccess = () => {
        const disc = req.result as SavedDisc | undefined
        if (!disc) return reject(new Error('disc missing'))
        // Spotify was removed: discs saved with Spotify tracks keep the rest
        resolve({ ...disc, items: disc.items.filter((i) => (i.kind as string) !== 'spotify') })
      }
    })
  } finally {
    db.close()
  }
}

export async function deleteDisc(id: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('discs', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.objectStore('discs').delete(id)
    })
  } finally {
    db.close()
  }
}
