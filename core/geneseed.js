const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const envPath = path.join(process.cwd(), '.env');
    let seedContent = process.env.GENE_SEED_CONTENT;
    let expectedHash = process.env.GENE_SEED_HASH;

    // Si dotenv n'a pas encore tourné (comme dans ton index.js), on extrait manuellement les clés nécessaires
    if (fs.existsSync(envPath) && (!seedContent || !expectedHash)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const matchContent = envContent.match(/^GENE_SEED_CONTENT=(.*)$/m);
        const matchHash = envContent.match(/^GENE_SEED_HASH=(.*)$/m);
        
        if (matchContent) seedContent = matchContent[1].trim();
        if (matchHash) expectedHash = matchHash[1].trim();
    }

    const seedPath = path.join(process.cwd(), '.geneseed');

    // Création automatique du fichier physique pour Render
    if (!fs.existsSync(seedPath) && seedContent) {
        fs.writeFileSync(seedPath, seedContent.trim());
    }

    if (!expectedHash || !fs.existsSync(seedPath)) {
        return false;
    }

    const content = fs.readFileSync(seedPath, 'utf8').trim();
    const currentHash = crypto.createHash('sha256').update(content).digest('hex');

    return currentHash === expectedHash;
}

module.exports = { verify };
