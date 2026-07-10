// core/geneseed.js
// GÈNE-SEED — Condition d'existence de Gilgamesh
// Vérifié en première ligne d'index.js, avant .env.
// Seul crash volontaire autorisé dans tout le corps (Loi 4, Codex Partie 4).
//
// CORRIGÉ : la vérification est réactivée. Le hash attendu est stocké dans
// GENESEED_HASH (variable d'env). Si absent → mode dev tolérant.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const seedPath = path.join(process.cwd(), '.geneseed');

    if (!fs.existsSync(seedPath)) {
        console.error('[GÈNE-SEED] Erreur : Fichier .geneseed introuvable.');
        return false;
    }

    const rawContent = fs.readFileSync(seedPath, 'utf8');
    const cleanedContent = rawContent.replace(/[\r\n\s]/g, '');
    const currentHash = crypto.createHash('sha256').update(cleanedContent).digest('hex');

    const expectedHash = process.env.GENESEED_HASH;

    if (!expectedHash) {
        console.warn('[GÈNE-SEED] ⚐️  GENESEED_HASH absent du .env — mode développement, accès toléré.');
        console.warn(`[GÈNE-SEED] Hash actuel : ${currentHash}  (ajoute GENESEED_HASH=... dans .env)`);
        return true;
    }

    if (currentHash !== expectedHash) {
        console.error('══════════════════════════════════════════════════');
        console.error('[GÈNE-SEED] ⛔ IDENTITÉ BORROMPUEE — ARRÊT IMMÉDIAT');
        console.error(`[GÈNE-SEED] Attendu : ${expectedHash}`);
        console.error(`[GÈNE-SEED] Obtenu  : ${currentHash}`);
        console.error('══════════════════════════════════════════════');
        return false;
    }

    console.log('[GÈNE-SEED] ✓ Identité confirmée. Squelette autorisé à se lever.');
    return true;
}

module.exports = { verify };
