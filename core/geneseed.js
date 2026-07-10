const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const seedPath = path.join(process.cwd(), '.geneseed');
    
    if (!fs.existsSync(seedPath)) {
        console.error("[GÈNE-SEED] Erreur : Fichier .geneseed introuvable.");
        return false;
    }

    // On lit le fichier .geneseed
    const rawContent = fs.readFileSync(seedPath, 'utf8');
    
    // On calcule le hash du contenu exact qui est sur ton GitHub (avec son saut de ligne automatique)
    const currentHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    
    // Le hash que ton Render attend (qui inclut le formatage de GitHub)
    const expectedHash = "fcf0c5bc7c123a7f6289e1cd6a26ab2580b284716a449c6c47b4807e2bbf4ae7";

    if (currentHash !== expectedHash) {
        console.error("[GÈNE-SEED] Erreur : Alignement génétique rompu.");
        return false;
    }

    console.log("[GÈNE-SEED] Alignement parfait. Squelette activé.");
    return true;
}

module.exports = { verify };

