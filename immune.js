// security/immune.js
// Système Immunitaire — Coordinateur
// RÔLE : écoute le Sang, applique gate.js + filter.js, émet le verdict.
// Ne contient pas la logique de décision elle-même (déléguée à gate.js/filter.js) —
// juste l'orchestration. Voir CODEX — Loi 1 (La Frontière).
//
// CONVENTION D'ÉVÉNEMENTS (contrat à respecter quand Canaux sera construit) :
//   Écoute : 'canal:message:recu'   { senderId, text, canal }
//   Émet   : 'immunitaire:accepte'  { senderId, text, canal, estAdmin }
//            'immunitaire:bloque'   { senderId, raison, canal }
//
// Aucun autre organe ne doit envoyer un message brut au Nerf —
// tout message doit d'abord passer par ici.

const sang = require('../core/sang');
const gate = require('./gate');
const filter = require('./filter');

function activate() {
  sang.on('canal:message:recu', (payload = {}) => {
    const { senderId, text, canal } = payload;

    const verdict = filter.isSafeInput(text);
    if (!verdict.safe) {
      console.warn(`[IMMUNITAIRE] Bloqué (${verdict.raison}) — de ${senderId} via ${canal}`);
      sang.emit('immunitaire:bloque', { senderId, raison: verdict.raison, canal });
      return;
    }

    sang.emit('immunitaire:accepte', { senderId, text, canal, estAdmin: gate.isAdmin(senderId) });
  });

  console.log('[IMMUNITAIRE] Actif — en écoute sur le Sang.');
}

module.exports = { activate };
