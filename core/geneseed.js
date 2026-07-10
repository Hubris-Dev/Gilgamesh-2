const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verify() {
    const seedPath = path.join(process.cwd(), '.geneseed');
    
    if (!fs.existsSync(seedPath)) {
        console.error("[GÈNE-SEED] Erreur : Fichier .geneseed introuvable.");
        return false;
    }

    // Lecture du contenu brut
    const rawContent = fs.readFileSync(seedPath, 'utf8');
    
    // Calcul du hash sur le contenu brut tel quel
    const currentHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    
    // Nettoyage agressif pour tester la deuxième variante (sans aucun espace/saut de ligne)
    const cleanedContent = rawContent.replace(/[\r\n\s]/g, '');
    const cleanedHash = crypto.createHash('sha256').update(cleanedContent).digest('hex');

    // Les deux signatures valides possibles pour "Gilgamesh_2"
    const hashVersionWeb = "fcf0c5bc7c123a7f6289e1cd6a26ab2580b284716a449c6c47b4807e2bbf4ae7";
    const hashVersionBrute = "61517454911d516886e00192e22c4f169f9e57463f10ef9f47053e1f0e49539d";

    // Si l'une des deux correspond, l'identité est validée
    if (currentHash === hashVersionWeb || currentHash === hashVersionBrute || cleanedHash === hashVersionBrute) {
        console.log("[GÈNE-SEED] Alignement parfait. Squelette activé.");
        return true;
    }

    console.error("[GÈNE-SEED] Erreur : Alignement génétique rompu.");
    return false;
}

module.exports = { verify };
