// security/filter.js
// Système Immunitaire — Filtrage (contenu)
// RÔLE : décide si un contenu entrant est SÛR à transmettre au Nerf. Logique pure.
// Ne bloque jamais silencieusement : retourne toujours une raison.
//
// Vérifié pour l'instant (base minimale) :
//   - message vide / null
//   - longueur excessive (protection contre flood / payload énorme)
//
// TODO (à décider ensemble) : spam répété, mots-clés bloqués, rate limiting par utilisateur.

const LONGUEUR_MAX = 4000;

function isSafeInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { safe: false, raison: 'message vide' };
  }
  if (text.length > LONGUEUR_MAX) {
    return { safe: false, raison: `message trop long (${text.length} > ${LONGUEUR_MAX})` };
  }
  return { safe: true, raison: null };
}

module.exports = { isSafeInput, LONGUEUR_MAX };
