// core/geneseed.js
// Gène-seed — Vérification d'identité
// RÔLE : valider que le fichier .geneseed est authentique
// avant de laisser le Squelette se lever. CELA FONDE l'EXISTENCE
// du process — pas de fraude, pas de forgerie.
// Voir CODEX, Partie 4.

// Loi 4 : seul crash volontaire autorisé dans tout le corps.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verify() {
  const seedPath = path.join(process.cwd(), '.geneseed');
  const refHash = process.env.GENESEED_HASH;

  if (!refHash) {
    console.error('[GÊNE-SEED] GENESEED_HASH absent — impossible de vérifier l\'identité.');
    return false;
  }

  if (!fs.existsSync(seedPath)) {
    console.error('[GÊNE-SEED] Fichier .geneseed introuvable.');
    return false;
  }

  const rawContent = fs.readFileSync(seedPath, 'utf-8');
  // Nettoyer les whitespace pour éviter les problèmes de saut de ligne
  // entre Windows/Mac/Linux/Render. La signification du contenu
  // n'est pas altérée par les caractres de contrôle.
  const cleanedContent = rawContent.replace(/[\r\n\s]/g, '');
  const computedHash = crypto.createHash('sha256').update(cleanedContent).digest('hex');

  if (computedHash !== refHash) {
    console.error(`[GÊNE-SEED] Hash invalide. Attendu: ${refHash}, Calculé: ${computedHash}`);
    return false;
  }

  console.log('[GÊNE-SEED] ✓ Identité confirmée. Squelette autorisé à se lever.');
  return true;
}

module.exports = { verify };
