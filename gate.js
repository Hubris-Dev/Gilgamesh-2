// security/gate.js
// Système Immunitaire — Barrière (accès)
// RÔLE : décide QUI a le droit de passer. Logique pure, pas d'I/O, pas d'event bus ici.
// Testable en isolation. Voir CODEX — Système Immunitaire.
//
// Pour l'instant : liste blanche d'admins via .env (ADMIN_IDS, séparés par des virgules).
// isAdmin() ne bloque PAS l'accès général au bot (tout le monde doit pouvoir lui parler) —
// elle sert à protéger les commandes sensibles plus tard, au niveau du Nerf.

function getAdminIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

function isAdmin(senderId) {
  if (!senderId) return false;
  return getAdminIds().includes(senderId);
}

module.exports = { isAdmin, getAdminIds };
