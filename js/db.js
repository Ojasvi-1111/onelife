// The iPad's database (IndexedDB). Every change is written in one transaction.
const DB_NAME = 'onelife';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('goalId', 'goalId');
          store.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('The database could not be opened'));
      req.onblocked = () => reject(new Error('The database is in use by another tab'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export async function loadAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['goals', 'entries', 'settings'], 'readonly');
    const goals = tx.objectStore('goals').getAll();
    const entries = tx.objectStore('entries').getAll();
    const settings = tx.objectStore('settings').get('app');
    tx.oncomplete = () => resolve({
      goals: goals.result || [],
      entries: entries.result || [],
      settings: settings.result ? settings.result.value : null
    });
    tx.onerror = () => reject(tx.error || new Error('Reading failed'));
    tx.onabort = () => reject(tx.error || new Error('Reading was aborted'));
  });
}

// ops: { clear, putGoals, deleteGoalIds, putEntries, deleteEntryIds, settings }
export async function commit(ops) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['goals', 'entries', 'settings'], 'readwrite');
    const goals = tx.objectStore('goals');
    const entries = tx.objectStore('entries');
    const settings = tx.objectStore('settings');
    if (ops.clear) { goals.clear(); entries.clear(); settings.clear(); }
    (ops.putGoals || []).forEach((g) => goals.put(g));
    (ops.deleteGoalIds || []).forEach((id) => goals.delete(id));
    (ops.putEntries || []).forEach((e) => entries.put(e));
    (ops.deleteEntryIds || []).forEach((id) => entries.delete(id));
    if (ops.settings) settings.put({ key: 'app', value: ops.settings });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Saving failed'));
    tx.onabort = () => reject(tx.error || new Error('Saving was aborted'));
  });
}
