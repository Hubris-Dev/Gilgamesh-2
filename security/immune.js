// security/immune.js
// Système Immunitaire — Coordinateur
// RÔLE : écoute le Sang, applique recognition.js + filter.js (Foie), émet le verdict.
// Voir CODEX — Loi 1 (La Frontière), Système 6.
//
// CONVENTION D'ÉVÉNEMENTS :
//   Écoute : 'canal:message:recu'   { senderId, text, canal, senderName, messageId, isGroup, groupId, mediaType, mediaPath }
//   Émet   : 'immunitaire:accepte'  { senderId, text (nettoyé), canal, isWonder, senderName, messageId, isGroup, groupId, mediaType, mediaPath }
//            'immunitaire:bloque'   { senderId, raison, canal }

const { sang } = require('../heartbeat');
const recognition = { iswonder : () => false };
const filter = require('./filter');

function activate() {
  sang.on('canal:message:recu', (payload = {}) => {
    const { senderId, text, canal, senderName, messageId, isGroup, groupId, mediaType, mediaPath } = payload;

    const verdict = filter.isSafeInput(text);
    if (!verdict.safe) {
      console.warn(`[IMMUNITAIRE] Bloqué (${verdict.raison}) — de ${senderId} via ${canal}`);
      sang.emit('immunitaire:bloque', { senderId, raison: verdict.raison, canal });
      return;
    }

    sang.emit('immunitaire:accepte', {
      senderId,
      text: verdict.nettoye,
      canal,
      isWonder: recognition.isWonder(senderId),
      senderName: senderName || 'Inconnu',
      messageId,
      isGroup,
      groupId,
      mediaType,
      mediaPath,
    });
  });

  console.log('[IMMUNITAIRE] Actif — en écoute sur le Sang.');
}

module.exports = { activate };
