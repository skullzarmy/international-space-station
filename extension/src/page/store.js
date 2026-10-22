/*
 * Minimal IndexedDB wrapper. Soundboard clips and the Mix Station folder
 * handle are stored in your browser only.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  const DB_NAME = 'iss-international-space-station';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = root.indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          let result;
          const r = fn(s);
          if (r && 'onsuccess' in r) r.onsuccess = () => (result = r.result);
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  ISS.store = {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    put: (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
