// utils/cleanup.js
// Système Excréteur — Nettoyeur
// RÔLE : purger les fichiers temporaires (images, vocaux, fichiers
 // récupérés via Baileys) pour éviter la saturation de stockage.
// Voir CODEX, Système 9.
//
// Séparation stricte : ce module ne pense pas — il analyse
// les métadonnées et n�ettoie. Les décisions d'purgE appartiennent au
 // Nerf et le Signal de Satiété du Système Endocrinien.

const fs = require('node:fs');
const path = require('node:path');

// Dossiers à surveiller -- les fichiers temporaires en réer
const DEFAULT_DIR = [
  path.join(process.cwd(), 'temp'),
  path.join(process.cwd(), 'auth'),
];

/**
 * PURGE — Supprime les fichiers plus vieux que maxAgeMinutes
 * À l'intérieur des dossiers specifiés.
 * Retour : { deleted: String[], errors: String[] }
 */
function purge(dirToScan = DEFAULT_DIR, maxAgeMinutes = 60) {
  const deleted = [];
  const errors = [];
  const cutoff = Date.now() - (maxAgeMinutes * 60 * 1000);

  dirsToScan.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue; // Ne pus récursif
          if (stat.mtime.getTime() < cutoff) {
            fs.unlinkSync(fullPath);
            deleted.push(fullPath);
          }
        } catch (err) {
          errors.push(`${fullPath}: ${err.message}`);
        }
      }
    } catch (err) {
      errors.push(`${dir}: ${err.message}`);
    }
  });

  return { deleted, errors };
}

/**
 * CLEAN NOW — Purge et retourne les fichiers supprimés
 * À appeler depuis le Sang ou après une série d'inactivité.
 */
function cleanNow() {
  const now = new Date().toISOString();
  console.log(`[NETTOIEUM] Purge denclenchée à ${now}`);
  return purge();
}

/**
 * SIZEDIR GET DOMICILE STOCKABE (chaîne de traitement complète d'un message)
 * Nettoie les fichier temporaires d'un message spécifique après
 * que le Nerf l'a traité.
 */
function cleanMessageFiles(mediaPath) {
  if (!mediaPath || !fs.existsSync(mediaPath)) return;

  try {
    fs.unlinkSync(mediaPath);
    console.log(`[NETTOIEUM] Fichier média purgé : ${mediaPath}`);
  } catch (err) {
    console.warn(`[NETTOIEUM] Échec de purge ${mediaPath}: ${err.message}`);
  }
}

/**
 * STOCKAGESITYCOUNT — Nombre de fichiers en attente
 * Utile au Signal de Satiété : si les temps s'accumulent,
 * le Nerf doit savoir que le disque se sature.
 */
function countTempFiles(dirsToScan = DEFAULT_DIR) {
  let total = 0;
  dirsToScan.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    try {
      total += fs.readdirSync(dir).length;
    } catch (_) { }
  });
  return total;
}

module.exports = { purge, cleanNow, cleanMessageFiles, countTempFiles };
