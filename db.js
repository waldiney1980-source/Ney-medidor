// Camada de persistência local (IndexedDB) — o app funciona 100% offline.

const DB_NAME = 'hidroluz';
const DB_VERSION = 1;
export const STORES = ['sites', 'meters', 'readings', 'photos', 'kv'];

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sites')) db.createObjectStore('sites', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meters')) {
        const s = db.createObjectStore('meters', { keyPath: 'id' });
        s.createIndex('code', 'code', { unique: false });
      }
      if (!db.objectStoreNames.contains('readings')) {
        const s = db.createObjectStore('readings', { keyPath: 'id' });
        s.createIndex('meterId', 'meterId', { unique: false });
        s.createIndex('readAt', 'readAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  getAll(store) {
    return tx(store, 'readonly', (s) => s.getAll());
  },
  get(store, id) {
    return tx(store, 'readonly', (s) => s.get(id));
  },
  put(store, value) {
    return tx(store, 'readwrite', (s) => { s.put(value); return value; });
  },
  bulkPut(store, values) {
    return tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); return values.length; });
  },
  del(store, id) {
    return tx(store, 'readwrite', (s) => s.delete(id));
  },
  clear(store) {
    return tx(store, 'readwrite', (s) => s.clear());
  },
  async kvGet(key, fallback = null) {
    const r = await tx('kv', 'readonly', (s) => s.get(key));
    return r ? r.value : fallback;
  },
  kvSet(key, value) {
    return tx('kv', 'readwrite', (s) => { s.put({ key, value }); return value; });
  },
  async wipe() {
    for (const s of STORES) await this.clear(s);
  },
};

/** Espaço ocupado, quando o navegador expõe a informação. */
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

/** Pede armazenamento persistente para que o SO não descarte as leituras. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
