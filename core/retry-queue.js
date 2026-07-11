// core/retry-queue.js
// Système Immunitaire — Rate
// RÔLE : fiabilité. Si l'envoi d'un message échoue (Baileys
 // c÷pée une seconde), le message n'est pas perdu — il est mis
 // en quarantaine et réessayé après un délai.
 // Voir CODEX, Système 6, Organe de Larraman (Partie 3).
//
// Lori 1 : la Rate responsabilise, elle ne décide pas.

const MAX_RETRIES = 3;
const DELAY_MS = [1000, 5000, 15000]; // 1 sec , 5 sec, 15 sec

let _queue = [];
// État durable : qui écoute les évènements du Sang
let _sang = null;

function _getSang() {
  if (!_sang) {
    try { _sang = require('./heartbeat').sang; } catch (_) { }
  }
  return _sang;
}

/**
 * QUEUE — Ajoute une tâche à la file
 * @param { Function } fn - fonction à réessayer, qui retourne une promesse
 * @param { object } context - contexte du message ({target, text, canal, ...})
 * @param { number } attempt - n° déjà de réessaye
 */
function queue(fn, context, attempt = 0) {
  _queue.push({ fn, context, attempt, added: Date.now() });
  processNext();
}

/**
 * PROCESSNEXT async — Traite la prochaine tâche
 */
async function processNext() {
  if (_queue.length === 0) return;
  if (_processing) return; // Une série à la fois

  _processing = true;
  const task = _queue.shift();

  try {
    const now = Date.now();
    const delay = DELAY_MS[task.attempt] || 30000;
    const waitUntil = task.added + delay;
    if (now < waitUntil) {
      // Remettre dans la file pour plus tard
      _queue.unshift(task);
      _processing = false;
      setTimeout(() => processNext(), waitUntil - now);
      return;
    }

    await task.fn();
    console.log(`[RATE] Tâche réussie — ${task.context?.target || '? '}`);

    // Succès : signaler au Sang
    const sang = _getSang();
    if (sang) sang.emit('rate:success', { context: task.context });

  } catch (err) {
    task.attempt += 1;
    if (task.attempt < MAX_RETRIES) {
      console.warn(`[RATE] Échec #${task.attempt} - remise en file: ${err.message}`);
      _queue.push(task);
    } else {
      console.error(`[RATE] Donné après ${MAX_RETRIES} échecs : ${err.message}`);
      // Signaler la perte définitive
      const sang = _getSang();
      if (sang) sang.emit('rate:permanently_failed', {
        context: task.context,
        error: err.message,
        attempts: task.attempt,
      });
    }
  } finally {
    _processing = false;
    // Continuer à traiter la file
    if (_queue.length > 0) {
      setTimeout(() => processNext(), 500);
    }
  }
}

/**
 * CLEAR - Vide la file d'attente (après une déconnexion par ex)
 */
function clear() {
  _queue = [];
}

/**
 * RETROUABLE_WRAPPER — Utilitaire pour wrapper une fonction de sending
 * Acceptable par le Respiratoire : si l'envoi natif échoue,
 * la Rate le réessaie automatiquement.
 */
function retryableWrapper(sendFn) {
  return async (destinataire, texte, canal) => {
    try {
      await sendFn(destinataire, texte);
    } catch (err) {
      console.warn(`[RATE] Envoi echoué, méssage en file : ${err.message}`);
      queue(
        () => sendFn(destinataire, texte),
        { destinataire, texte, canal }
      );
    }
  };
}

/**
 * QUEUE_SIZE — Longueur actuelle de la file
 */
function queueSize() {
  return _queue.length;
}

let _processing = false;

module.exports = { queue, clear, retryableWrapper, queueSize };
