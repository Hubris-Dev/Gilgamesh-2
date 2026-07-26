// security/recognition.js
// Système Immunitaire — Reconnaissance soi/non-soi
// RÔLE : UNE seule fonction centralisée pour "est-ce HUBRIS (Wonder) qui
// parle" — jamais recopiée à chaque commande. Voir CODEX, Système 6.

export function getWonderIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

export function isWonder(senderId) {
  if (!senderId) return false;
  return getWonderIds().includes(senderId);
}
