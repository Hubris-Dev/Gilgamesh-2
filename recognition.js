// security/recognition.js
// Système Immunitaire — Reconnaissance soi/non-soi
// RÔLE : UNE seule fonction centralisée pour "est-ce HUBRIS (Wonder) qui
// parle" — jamais recopiée à chaque commande (erreur trouvée dans l'ancien
// handleCommand, où isWonder était vérifié 3 fois séparément). Voir CODEX,
// Système 6.
//
// CORRECTION IMPORTANTE : remplace l'ancien security/gate.js. Le VRAI
// gate.js (Codex, Système 6 — "Les Portes de Babylone") est la capacité de
// Gilgamesh à modifier SON PROPRE CODE dans un fil isolé. Je m'étais trompé
// plus tôt (Codex pas encore en contexte) en construisant un simple contrôle
// d'accès sous ce nom. Le vrai gate.js n'est PAS construit — auto-
// modification de code, ça se décide ensemble, délibérément.

function getWonderIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

function isWonder(senderId) {
  if (!senderId) return false;
  return getWonderIds().includes(senderId);
}

module.exports = { isWonder, getWonderIds };
