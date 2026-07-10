// security/filter.js
// Système Immunitaire — Foie (filtrage/sanitation)
// RÔLE : intercepte la donnée avant qu'elle touche le Nerf ou la Mémoire.
// Ne pense pas, applique des règles sanitaires strictes, détruit
// silencieusement le toxique. Voir CODEX, Système 6.

const LONGUEUR_MAX = 4000;

// Caractères invisibles / de contrôle — dissimulation de contenu, corruption de stockage.
const CARACTERES_INVISIBLES = /[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

// Motifs grossiers d'injection NoSQL — défense en profondeur.
// La vraie protection reste les requêtes paramétrées dans memory/mongo.js.
const MOTIF_INJECTION = /^\s*\$|"\$where"\s*:|"\$ne"\s*:|"\$gt"\s*:/;

function sanitize(text) {
  return text.replace(CARACTERES_INVISIBLES, '').trim();
}

function isSafeInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { safe: false, raison: 'message vide' };
  }

  const nettoye = sanitize(text);

  if (nettoye.length === 0) {
    return { safe: false, raison: 'ne contenait que des caractères invisibles' };
  }
  if (nettoye.length > LONGUEUR_MAX) {
    return { safe: false, raison: `message trop long (${nettoye.length} > ${LONGUEUR_MAX})` };
  }
  if (MOTIF_INJECTION.test(nettoye)) {
    return { safe: false, raison: 'motif suspect (injection)' };
  }

  return { safe: true, raison: null, nettoye };
}

module.exports = { isSafeInput, sanitize, LONGUEUR_MAX };

