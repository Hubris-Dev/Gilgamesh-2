// index.js — Système Squelettique
// RÔLE : la charpente. Démarre les autres systèmes, dans un ordre fixe, et RIEN d'autre.
// AUCUNE logique de décision ici (pas de handleCommand, pas de handleAI, pas de send()).
// Voir CODEX — Système 1, Loi 1 (La Frontière), Loi 2 (L'Autorité Mécanique).

const geneseed = require('./core/geneseed');

// ── ÉTAPE 1 — Gène-seed ───────────────────────────────────────────
// Avant même .env. Seul crash volontaire autorisé dans tout le corps (Loi 4).
if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gène-seed invalide. Arrêt.');
  process.exit(1);
}

// ── ÉTAPE 2 — Chargement de .env ──────────────────────────────────
require('dotenv').config();

// ── ÉTAPE 3 — Sang (event bus) ────────────────────────────────────
// Fondation de communication. Doit exister avant que tout autre organe
// ne puisse emit() ou on(). Aucun organe ne s'appelle directement.
const sang = require('./core/sang');

// ── ÉTAPE 4 — Système Immunitaire ─────────────────────────────────
// Armé avant Canaux (étape 7) : aucune porte ne s'ouvre sur l'extérieur
// avant que le filtrage soit en écoute sur le Sang.
require('./security/immune').activate();

// ── ÉTAPE 5 — Connexion Mémoire (MongoDB) ─────────────────────────
// TODO : require('./memory/mongo').connect()

// ── ÉTAPE 6 — Démarrage du Pouls (Heartbeat) ──────────────────────
// TODO : require('./core/heartbeat').start()

// ── ÉTAPE 7 — Connexion des Canaux (WhatsApp en priorité) ─────────
// TODO : require('./channels/whatsapp').connect()

// ── ÉTAPE 8 — Activation du Nerf ──────────────────────────────────
// TODO : require('./brain').activate()

console.log('[SQUELETTE] Démarrage OK — étapes 1 à 4 actives. Reste en attente de construction.');
sang.emit('squelette:pret', { horodatage: new Date().toISOString() });
