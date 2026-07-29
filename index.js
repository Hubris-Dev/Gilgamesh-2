// index.js — Système Squelettique
import 'dotenv/config';

import express from 'express';
import * as geneseed from './core/geneseed.js';
import * as scheduler from './core/scheduler.js';
import * as memoire from './memory/mongo.js';
import * as heartbeatModule from './core/heartbeat.js';
import * as whatsapp from './channels/whatsapp.js';
import * as immune from './security/immune.js';
import { activateMuscle } from './muscle.js';
import { activateBrain } from './brain.js';
import { cleanNow } from './utils/cleanup.js';

function resumerErreur(err) {
  if (err instanceof Error) return err.stack || err.message;
  if (err && typeof err === 'object') {
    const cles = Object.keys(err).join(', ') || 'aucune';
    return `[objet non-Error] constructeur=${err.constructor?.name || '?'} clés de premier niveau=${cles}`;
  }
  return String(err);
}

process.on('unhandledRejection', (reason) => {
  console.error('[SQUELETTE] Rejet de promesse non géré :', resumerErreur(reason));
});

process.on('uncaughtException', (err) => {
  console.error('[SQUELETTE] Exception non capturée :', resumerErreur(err));
});

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

async function boot() {
  immune.activate();
  await memoire.connect();
  console.log('[SQUELETTE] MongoDB connecté.');

  const { sang, start: startHeartbeat } = heartbeatModule;
  startHeartbeat();

  try {
    const { initializeKryvenClient } = await import('./core/kryven-client.js');
    initializeKryvenClient();
  } catch (e) {
    console.error('[SQUELETTE] Kryven init échoué — poursuite sur fallback Groq :', e.message);
  }

  whatsapp.connect();

  scheduler.start();
  scheduler.add('nettoyeur-temp', async () => {
    const r = cleanNow();
    if (r.deleted.length) console.log('[THYROIDE] Purge :', r.deleted.length, 'fichiers.');
  }, 60 * 60 * 1000);
  scheduler.add('metabolisme-memoire', async () => {
    sang.emit('nerf:metabolismCheck', {});
  }, 5 * 60 * 1000);

  activateMuscle();
  activateBrain();

  console.log('[SQUELETTE] Démarrage OK — tous les systèmes actifs.');
  sang.emit('squelette:pret', { horodatage: new Date().toISOString() });
}

boot().catch((e) => {
  console.error('[SQUELETTE] Échec critique au démarrage :', e.message);
  process.exit(1);
});

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