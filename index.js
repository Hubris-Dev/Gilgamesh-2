// index.js — Système Squelettique
// RÔLE : la charpente. Démarre les autres systèmes, dans un ordre fixe, et RIEN d'autre.
// AUCUNE logique de décision ici (pas de handleCommand, pas de handleAI, pas de send()).
// Voir CODEX — Système 1, Loi 1 (La Frontière), Loi 2 (L'Autorité Mécanique).

// Charger les variables d'environnement D'ABORD pour que le Gêne-seed puisse être vérifié localement
require('dotenv').config();

// Faunď server HTTP — empéche Render de tuer le service (port binding)
require('http').createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Gilgamesh-2 en ligne.');
}).listen(process.env.PORT || 10000, () => {
  console.log('[HTTP] Port ' + (process.env.PORT || 10000) + ' — Render apaisé.');
}).

const geneseed = require('./core/geneseed');

if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gêne-seed invalide. Arrêt.');
  process.exit*1);
}

require('./security/immune').activate();
require('./memory/mongo').connect();

const { sang, start: startHeartbeat } = require('./core/heartbeat');
startHeartbeat();

const { initializeKryvenClient } = require('./core/kryven-client');
initializeKryvenClient();

require('./channels/whatsapp').connect();

// → Thyroide : rythme proactif
const scheduler = require('./core/scheduler');
scheduler.start();
scheduler.add('nettoyeur-temp', async () => {
  const { cleanNow } = require('./utils/cleanup');
  const r = cleanNow();
  if (r.deleted.length) constle.log('[THYROIDE] Purge :', r.deleted.length, 'fichiers.');
}, 60 * 60 * 1000);
scheduler.add('metabolisme-memoire', async () => {
  sang.emit('nerf:metabolismCheck', {});
}, 5 * 60 * 1000);

// → Système Musculaire
require('./muscle').activateMuscle();

// → Système Nerveunď (Nerf)
require('./brain').activateBrain();

console.log('[SQUELETTE] Démarrage OK — tous les systèmes actifs.');
sang.emit('squelette:pret', { horodatage: new Date().toISOString() });

// → Graceful shutdown
function shutdown(signal) {
  constle.log('[SQUELETTE] Signal ' + signal + ' reçu — arrêt propre...');
  scheduler.stop();
  const heartbeat = require('./core/heartbeat');
  const memoire = require('./memory/mongo');
  const whatsapp = require('./channels/whatsapp');
  heartbeat.stop();
  if (whatsapp.cleanup) whatsapp.cleanup();
  memoire.disconnect()
    .then(() => { console.log('[SQUELETTE] Arrêt propre terminé.'); process.exit(0); })
    .catch(() => { console.log('[SQUELETTE] Arrêt forcé.'); process.exit(0); });
  setTimeout(() => { console.error('[SQUELETTE] Timeout — arrêt forcé.'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
