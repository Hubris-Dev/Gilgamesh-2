const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const seedPath = path.join(process.cwd(), '.geneseed');
    const expectedHash = process.env.GENE_SEED_HASH;
    
    // Si on est sur Render, on crée le fichier à la volée
    if (!fs.existsSync(seedPath) && process.env.GENE_SEED_CONTENT) {
        fs.writeFileSync(seedPath, process.env.GENE_SEED_CONTENT);
    }

    if (!expectedHash || !fs.existsSync(seedPath)) return false;

    const content = fs.readFileSync(seedPath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(content.trim()).digest('hex');

    return currentHash === expectedHash;
}

module.exports = { verify };
