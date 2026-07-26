// index.js — Système Squelettique
// RÔLE : la charpente. Démarre les autres systèmes, dans un ordre fixe, et RIEN d'autre.
// AUCUNE logique de décision ici (pas de handleCommand, pas de handleAI, pas de send()).
// Voir CODEX — Système 1, Loi 1 (La Frontière), Loi 2 (L'Autorité Mécanique).

// Charger les variables d'environnement D'ABORD pour que le Gêne-seed puisse être vérifié localement
import 'dotenv/config';

import express from 'express';
import * as geneseed from './core/geneseed.js';
// Imports hoistés en haut pour être réutilisables dans boot() ET shutdown()
import * as scheduler from './core/scheduler.js';
import * as memoire from './memory/mongo.js';
import * as heartbeatModule from './core/heartbeat.js';
import * as whatsapp from './channels/whatsapp.js';
import * as immune from './security/immune.js';
import { activateMuscle } from './muscle.js';
import { activateBrain } from './brain.js';
import { cleanNow } from './utils/cleanup.js';

// ─── Filets de sécurité globaux ────────────────────────────────────
// AVANT : aucune capture d'exception non gérée / rejet de promesse non géré.
// Une erreur async dans n'importe quel module (Baileys, un sang.on(), le
// scheduler...) tuait le process Node instantanément — parfois avant même
// que stdout ait fini de flush sur Render, d'où l'impression de "crash sans
// logs". Ces deux handlers garantissent qu'on logge TOUJOURS la vraie cause
// avant que quoi que ce soit ne puisse arrêter le process.
process.on('unhandledRejection', (reason) => {
  console.error('[SQUELETTE] Rejet de promesse non géré :', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SQUELETTE] Exception non capturée :', err && err.stack ? err.stack : err);
  // On ne fait PAS process.exit() ici : après une uncaughtException, Node
  // est dans un état possiblement instable, mais pour un bot conversationnel
  // il vaut mieux tenter de continuer et logger que de mourir en silence.
  // Si des crashs répétés apparaissent malgré ce log, la vraie cause sera
  // enfin visible dans les logs Render au lieu de disparaître.
});

// Serveur HTTP Express — empêche Render de tuer le service (port binding) et sert de Keep-Alive
const app = express();
app.get('/ping', (req, res) => res.status(200).send('Gilgamesh is awake'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[HTTP] Express Keep-Alive actif sur le port ${port} — Render apaisé.`);
});

if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gêne-seed invalide. Arrêt.');
  process.exit(1);
}

// → Démarrage séquentiel : chaque étape attend que la précédente soit vraiment prête
async function boot() {
  immune.activate();

  // Mongo DOIT être connecté avant tout système qui en dépend (heartbeat, brain, muscle...).
  // Avant : connect() était appelé sans await, donc heartbeat pouvait démarrer avant que Mongo soit prêt.
  await memoire.connect();
  console.log('[SQUELETTE] MongoDB connecté.');

  const { sang, start: startHeartbeat } = heartbeatModule;
  startHeartbeat();

  // Kryven ne doit JAMAIS faire crasher le Squelette — le fallback Groq doit pouvoir prendre le relais.
  // Avant : une erreur ici (clé manquante, timeout) tuait tout le processus.
  // NOTE (ESM) : import() dynamique conservé ici (plutôt qu'un import statique
  // en haut du fichier) précisément pour garder ce try/catch fonctionnel — un
  // import statique qui échoue à la résolution ferait planter tout le module
  // AVANT que boot() ne s'exécute, hors de portée de ce try/catch.
  try {
    const { initializeKryvenClient } = await import('./core/kryven-client.js');
    initializeKryvenClient();
  } catch (e) {
    console.error('[SQUELETTE] Kryven init échoué — poursuite sur fallback Groq :', e.message);
  }

  whatsapp.connect();

  // → Thyroide : rythme proactif
  scheduler.start();
  scheduler.add('nettoyeur-temp', async () => {
    const r = cleanNow();
    if (r.deleted.length) console.log('[THYROIDE] Purge :', r.deleted.length, 'fichiers.');
  }, 60 * 60 * 1000);
  scheduler.add('metabolisme-memoire', async () => {
    sang.emit('nerf:metabolismCheck', {});
  }, 5 * 60 * 1000);

  // → Système Musculaire
  activateMuscle();

  // → Système Nerveux (Nerf)
  activateBrain();

  console.log('[SQUELETTE] Démarrage OK — tous les systèmes actifs.');
  sang.emit('squelette:pret', { horodatage: new Date().toISOString() });
}

boot().catch((e) => {
  console.error('[SQUELETTE] Échec critique au démarrage :', e.message);
  process.exit(1);
});

// → Graceful shutdown
function shutdown(signal) {
  console.log('[SQUELETTE] Signal ' + signal + ' reçu — arrêt propre...');
  scheduler.stop();

  heartbeatModule.stop();
  if (whatsapp.cleanup) whatsapp.cleanup();

  memoire.disconnect()
    .then(() => { console.log('[SQUELETTE] Arrêt propre terminé.'); process.exit(0); })
    .catch(() => { console.log('[SQUELETTE] Arrêt forcé.'); process.exit(0); });

  setTimeout(() => { console.error('[SQUELETTE] Timeout — arrêt forcé.'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
