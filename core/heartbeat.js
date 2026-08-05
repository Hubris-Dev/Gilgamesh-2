// core/heartbeat.js
// Système Cardiovasculaire — Pouls + Sang
// PATCH 08/2025 : Ajout d'un healthcheck WhatsApp actif via getSocket()

import EventEmitter from 'node:events';

class Sang extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.on('error', (err) => {
      console.error('[SANG] Erreur non gérée transmise par un organe :', err);
    });
    this._debug = process.env.DEBUG_SANG === 'true';
  }

  emit(event, ...args) {
    if (this._debug && event !== 'error') {
      console.log(`[SANG] ${new Date().toISOString()} → ${event}`, ...args);
    }
    return super.emit(event, ...args);
  }
}

export const sang = new Sang();

const INTERVALLE_MS = Number(process.env.POULS_INTERVALLE_MS) || 30000;

const etatCanaux = {};

sang.on('canal:connecte', ({ canal } = {}) => {
  if (canal) etatCanaux[canal] = 'connecté';
});
sang.on('canal:deconnecte', ({ canal, raison } = {}) => {
  if (canal) etatCanaux[canal] = raison ? `déconnecté (${raison})` : 'déconnecté';
});

let intervalle = null;

// PATCH : référence à getSocket — injectée par index.js
let _getSocket = null;
export function setGetSocket(fn) {
  _getSocket = fn;
}

export function start() {
  if (intervalle) return;

  intervalle = setInterval(() => {
    const horodatage = new Date().toISOString();
    const canaux = Object.keys(etatCanaux).length ? { ...etatCanaux } : { aucun: 'aucun canal enregistré' };

    // PATCH : vérifier l'état réel de la socket WhatsApp
    if (_getSocket) {
      try {
        const sock = _getSocket();
        if (sock && sock.user) {
          canaux['whatsapp'] = 'connecté (vérifié)';
        } else if (sock) {
          canaux['whatsapp'] = '⚠️ socket présente mais non authentifiée';
        } else {
          canaux['whatsapp'] = '❌ déconnecté';
        }
      } catch (err) {
        canaux['whatsapp'] = 'erreur vérification: ' + err.message;
      }
    }

    console.log(`[POULS] ${horodatage} — battement. Canaux :`, canaux);
    sang.emit('pouls:battement', { horodatage, canaux });
  }, INTERVALLE_MS);

  intervalle.unref();
  console.log(`[POULS] Actif — battement toutes les ${INTERVALLE_MS / 1000}s.`);
}

export function stop() {
  if (intervalle) {
    clearInterval(intervalle);
    intervalle = null;
  }
}
