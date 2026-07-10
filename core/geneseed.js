// core/geneseed.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const seedPath = path.join(process.cwd(), '.geneseed');
    const expectedHash = process.env.GENE_SEED_HASH;

    // 1. Vérification sécurité : Hash présent ? Fichier présent ?
    if (!expectedHash || !fs.existsSync(seedPath)) return false;

    // 2. Lecture et hachage
    const content = fs.readFileSync(seedPath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(content.trim()).digest('hex');

    // 3. Validation
    return currentHash === expectedHash;
}

module.exports = { verify };
