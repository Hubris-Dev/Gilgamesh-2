// core/heartbeat.js
// Système Cardiovasculaire — Pouls + Sang
// RÔLE : le rythme (Pouls) ET la circulation de l'information (Sang) vivent
// dans le même organe — comme en anatomie réelle, c'est le cœur qui fait
// circuler le sang. Voir CODEX, Système 5.
//
// LE SANG : event bus central. Aucun organe ne s'appelle directement —
// tout passe par sang.emit()/sang.on(). Voir Loi 1 (La Frontière).
//
// LE POULS : boucle active dès le démarrage, journalise l'état de chaque
// canal en continu — même sans message entrant. Différence entre "le
// serveur tourne" et "Gilgamesh SAIT qu'il tourne" (Nœud Catalepséen, Partie 3).
//
// CORRECTION : remplace l'ancien core/sang.js. Le Sang n'est pas un système
// à part — il vit ici.

const EventEmitter = require('node:events');

// ─── LE SANG ──────────────────────────────────────────────────────
class Sang extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);

    // Garde-fou Loi 4 — un 'error' émis sans listener plante Node autrement.
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

const sang = new Sang();

// ─── LE POULS ─────────────────────────────────────────────────────
const INTERVALLE_MS = Number(process.env.POULS_INTERVALLE_MS) || 30000;

// État connu de chaque canal — mis à jour par les canaux eux-mêmes via le
// Sang, jamais lu/écrit directement depuis l'extérieur (Loi 1).
const etatCanaux = {};

sang.on('canal:connecte', ({ canal } = {}) => {
  if (canal) etatCanaux[canal] = 'connecté';
});
sang.on('canal:deconnecte', ({ canal, raison } = {}) => {
  if (canal) etatCanaux[canal] = raison ? `déconnecté (${raison})` : 'déconnecté';
});

let intervalle = null;

function start() {
  if (intervalle) return;

  intervalle = setInterval(() => {
    const horodatage = new Date().toISOString();
    const canaux = Object.keys(etatCanaux).length ? { ...etatCanaux } : { aucun: 'aucun canal enregistré' };

    console.log(`[POULS] ${horodatage} — battement. Canaux :`, canaux);
    sang.emit('pouls:battement', { horodatage, canaux });
  }, INTERVALLE_MS);

  intervalle.unref();
  console.log(`[POULS] Actif — battement toutes les ${INTERVALLE_MS / 1000}s.`);
}

function stop() {
  if (intervalle) {
    clearInterval(intervalle);
    intervalle = null;
  }
}

module.exports = { sang, start, stop };
