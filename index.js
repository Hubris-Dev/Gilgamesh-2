// index.js — Système Squelettique
// RÔLE : la charpente. Démarre les autres systèmes, dans un ordre fixe, et RIEN d'autre.
// AUCUNE logique de décision ici (pas de handleCommand, pas de handleAI, pas de send()).
// Voir CODEX — Système 1, Loi 1 (La Frontière), Loi 2 (L'Autorité Mécanique).
//
// Ordre exact du Codex : gène-seed → .env → Mémoire → Pouls → Canaux → Nerf.
// Immunitaire surveille en parallèle, dès l'étape 1 — pas un numéro dans la
// séquence, une présence constante depuis le début. Le Sang vit dans
// core/heartbeat.js (Système Cardiovasculaire), pas un organe séparé.

const geneseed = require('./core/geneseed');

// ── ÉTAPE 1 — Gène-seed ───────────────────────────────────────────
// Seul crash volontaire autorisé dans tout le corps (Loi 4).
if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gène-seed invalide. Arrêt.');
  process.exit(1);
}

// ── ÉTAPE 2 — Chargement de .env ──────────────────────────────────
require('dotenv').config();

// ── Système Immunitaire — en parallèle, dès maintenant ────────────
require('./security/immune').activate();

// ── ÉTAPE 3 — Connexion Mémoire (MongoDB, auth + conversationnelle) ──
// Tâche de fond, ne bloque pas le reste. Écoute 'memoire:connectee' sur
// le Sang si un organe doit vraiment attendre.
require('./memory/mongo').connect();

// ── ÉTAPE 4 — Démarrage du Pouls (le Sang vit dans le même organe) ──
const { sang, start: startHeartbeat } = require('../core/heartbeat');
startHeartbeat();

// ── ÉTAPE 4B — Initialisation du client IA ──────────────────────────
const { initializeKryvenClient } = require('./core/kryven-client');
initializeKryvenClient();

// ── ÉTAPE 5 — Connexion des Canaux (WhatsApp en priorité) ─────────
require('./channels/whatsapp').connect();

// ── ÉTAPE 6 — Activation du Nerf ──────────────────────────────────
require('./brain').activateBrain();

console.log('[SQUELETTE] Démarrage OK — tous les systèmes actifs.');
sang.emit('squelette:pret', { horodatage: new Date().toISOString() });
