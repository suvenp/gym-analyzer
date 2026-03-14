// db.js — Shared IndexedDB module for Gym Log Analyzer
// Used by index.html (analyzer), gym-logger.html (logger), and admin.html

(function() {
  const DB_NAME = 'GymLogDB';
  const DB_VERSION = 1;
  const STORE = 'sets';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('exercise', 'exercise', { unique: false });
          store.createIndex('workout_type', 'workout_type', { unique: false });
          store.createIndex('date_exercise', ['date', 'exercise'], { unique: false });
          store.createIndex('type_exercise', ['workout_type', 'exercise'], { unique: false });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function getAllSets() {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getCount() {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function bulkInsert(records) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      records.forEach(r => {
        const clean = Object.assign({}, r);
        delete clean.id; // let auto-increment assign id
        store.add(clean);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function seedIfEmpty(jsonUrl) {
    const count = await getCount();
    if (count > 0) return false;
    try {
      const res = await fetch(jsonUrl);
      if (!res.ok) return false;
      const data = await res.json();
      await bulkInsert(data);
      return true;
    } catch (e) {
      console.warn('Seed failed:', e);
      return false;
    }
  }

  function saveSessionSets(records) {
    return bulkInsert(records);
  }

  function deleteRecord(id) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function updateRecord(id, data) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = Object.assign(req.result, data);
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function clearAll() {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function exportAllJSON() {
    const data = await getAllSets();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gym-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!Array.isArray(data)) throw new Error('Expected JSON array');
          await bulkInsert(data);
          resolve(data.length);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function getStats() {
    const data = await getAllSets();
    const dates = new Set(data.map(s => s.date));
    const exercises = new Set(data.map(s => s.exercise));
    const types = {};
    data.forEach(s => {
      if (!types[s.workout_type]) types[s.workout_type] = new Set();
      types[s.workout_type].add(s.date);
    });
    const typeBreakdown = {};
    Object.entries(types).forEach(([t, d]) => typeBreakdown[t] = d.size);
    return {
      totalRecords: data.length,
      totalSessions: dates.size,
      totalExercises: exercises.size,
      dateRange: data.length ? [data[0].date, data[data.length - 1].date] : [null, null],
      typeBreakdown,
    };
  }

  // Build the DB object that gym-logger.html expects
  async function buildLoggerDB() {
    const data = await getAllSets();
    const result = {};

    const now = new Date();
    const cutoff6m = new Date(now);
    cutoff6m.setMonth(cutoff6m.getMonth() - 6);
    const cutoff6str = cutoff6m.toISOString().slice(0, 10);

    // Group by workout_type then exercise
    const byTypeEx = {};
    data.forEach(s => {
      const key = s.workout_type;
      if (!byTypeEx[key]) byTypeEx[key] = {};
      if (!byTypeEx[key][s.exercise]) byTypeEx[key][s.exercise] = [];
      byTypeEx[key][s.exercise].push(s);
    });

    for (const [type, exercises] of Object.entries(byTypeEx)) {
      result[type] = [];

      for (const [exName, sets] of Object.entries(exercises)) {
        // Sort by date then set_number
        sets.sort((a, b) => a.date.localeCompare(b.date) || a.set_number - b.set_number);

        // Group by date (sessions)
        const sessions = {};
        sets.forEach(s => {
          if (!sessions[s.date]) sessions[s.date] = [];
          sessions[s.date].push(s);
        });
        const sessionDates = Object.keys(sessions).sort();
        const lastDate = sessionDates[sessionDates.length - 1];

        // Skip exercises not done in the last 6 months
        if (lastDate < cutoff6str) continue;

        const lastSession = sessions[lastDate] || [];
        const workingSets = lastSession.filter(s => !s.is_warmup);
        const lastSets = workingSets.map(s => ({ w: s.weight_lbs, r: s.reps }));

        // Last RIR
        let lastRIR = null;
        for (let i = workingSets.length - 1; i >= 0; i--) {
          if (workingSets[i].rating_raw !== null) {
            lastRIR = workingSets[i].rating_raw;
            break;
          }
        }

        // PR — max weight across all non-warmup sets
        const allWorking = sets.filter(s => !s.is_warmup);
        const pr = allWorking.length ? Math.max(...allWorking.map(s => s.weight_lbs)) : 0;

        // Trend + stalled count
        let trend = 'new';
        let stalled = 0;
        if (sessionDates.length >= 2) {
          const recentDates = sessionDates.slice(-4);
          const topWeights = recentDates.map(d => {
            const ws = sessions[d].filter(s => !s.is_warmup);
            return ws.length ? Math.max(...ws.map(s => s.weight_lbs)) : 0;
          });
          const lastTop = topWeights[topWeights.length - 1];
          const prevTop = topWeights[topWeights.length - 2];

          if (lastTop > prevTop) {
            trend = 'progressing';
          } else if (lastTop === prevTop) {
            trend = 'holding';
            for (let i = topWeights.length - 2; i >= 0; i--) {
              if (topWeights[i] <= lastTop) stalled++;
              else break;
            }
          } else {
            trend = 'stalled';
            stalled = 1;
            for (let i = topWeights.length - 2; i >= 0; i--) {
              if (topWeights[i] >= lastTop) stalled++;
              else break;
            }
          }
        } else if (sessionDates.length === 1) {
          trend = 'progressing';
        }

        // Superset detection
        let superset = null;
        const ssId = lastSession.find(s => s.superset_id)?.superset_id;
        if (ssId) {
          const sameDate = data.filter(s => s.date === lastDate && s.superset_id === ssId && s.exercise !== exName);
          if (sameDate.length > 0) superset = sameDate[0].exercise;
        }

        // Alts — other exercises of same workout type (all time, for surprise me)
        const alts = Object.keys(exercises).filter(n => n !== exName);

        // Count sessions in last 6 months for sorting
        const recentSessionCount = sessionDates.filter(d => d >= cutoff6str).length;

        result[type].push({
          name: exName,
          superset,
          lastSets,
          lastRIR,
          pr,
          stalled,
          trend,
          alts,
          _lastDate: lastDate,
          _recentCount: recentSessionCount,
        });
      }

      // Sort by recent frequency
      result[type].sort((a, b) => b._recentCount - a._recentCount);

      // Clean up internal sort fields
      result[type].forEach(ex => { delete ex._lastDate; delete ex._recentCount; });
    }

    if (!result.Freedom) result.Freedom = [];
    return result;
  }

  // Expose globally
  window.GymDB = {
    open,
    seedIfEmpty,
    getAllSets,
    getCount,
    buildLoggerDB,
    saveSessionSets,
    deleteRecord,
    updateRecord,
    clearAll,
    exportAllJSON,
    importJSON,
    getStats,
  };
})();
