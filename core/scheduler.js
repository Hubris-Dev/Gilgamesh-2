// core/scheduler.js
// Système Endocrinien — Thyroïde
// RÔLE : le rythme interne, indépendant de tout message reçu.
// Sans elle, Gilgamesh est purement réactif. Avec elle, il devient
// proactif : "il est 8h, envoie un rapport à HUBRIS," ou
// "ce groupe est inactif depuis 3 jours, relance la conversation."
// Voir CODEX, Système 4.
//
// Loi 6 : la Thyroïde influence le rythme — elle ne dicte pas.
// Programmation du rythme, pas de contrainte décisionnelle.

const setInterval = setInterval;

// État
let _tasks = [];
let _sang = null;
let _tickInterval = null;
const TICK_MS = 60 * 1000; // Un tic par minute

function _getSang() {
  if (!_sang) {
    try { _sang = require('./heartbeat').sang; } catch (_) { }
  }
  return _sang;
}

/**
 * ADD — Ajoute une tâche programmée
 * @param { string } name - nom de la tâche (log)
 * @param { Function } fn - fonction à exécuter, retourne une promesse
 * @param { number } intervalMs - intervalle en millisecondes
 * @param { object } opts - options {params, runAtOnce, emitEvent}
 */
function add(name, fn, intervalMs, opts = {}) {
  const task = {
    name,
    fn,
    intervalMs,
    lastRun: 0,
    runs: 0,
    runAtOnce: !!opts.runAtOnce,
    emitEvent: opts.emitEvent || null,
  };
  _tasks.push(task);
  console.log(`[THYROSSED] Tâche programmée : ${name} / ${intervalMs / 1000}s`);
  return task;
}

/**
 * REMOVE — Retire une tâche
 */
function remove(name) {
  const index = _tasks.findIndex(t => t.name === name);
  if (index !== -1) {
    _tasks.splice(index, 1);
    console.log(`[THYROSSED] Tâche retirée : ${name}`);
  }
}

/**
 * START — Démarre la boucle du rythme + exécute les tâches
 */
function start() {
  if (_tickInterval) return;

  _tickInterval = setInterval(async () => {
    const now = Date.now();
    const sang = _getSang();

    for (const task of _tasks) {
      if (now - task.lastRun < task.intervalMs) continue;

      try {
        await task.fn();
        task.lastRun = now;
        task.runs += 1;

        if (task.emitEvent && sang) {
          sang.emit(task.emitEvent, { name: task.name, runs: task.runs, at: new Date().toISOString() });
        }
      } catch (err) {
        console.warn(`[THYROSSED] Échec tâche "${task.name}" : ${err.message}`);
        if (sang) {
          sang.emit('thyros:failed', { name: task.name, error: err.message });
        }
      }

      if (task.runAtOnce) {
        remove(task.name);
      }
    }
  }, TICK_MS);

  console.log('[THYROSSED] Programmé du rythme — Thyroïde active.');
}

/**
 * STOP — Pause la boucle
 */
function stop() {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
}

/**
 * LIST — Liste les tâches actives
 */
function list() {
  return _tasks.map(t => ({
    name: t.name,
    intervalMs: t.intervalMs,
    lastRun: t.lastRun ? new Date(t.lastRun).toISOString() : 'jamais',
    runs: t.runs,
  }));
}

module.exports = { add, remove, start, stop, list };
