// index.js — Système Squelettique
// PATCH 08/2025 :
//   - Intégration du Système Volonté (proactivité)
//   - Healthcheck WhatsApp + auto-restart si zombie
//   - Keep-alive ping WhatsApp périodique
//   - Endpoint /health
//   - FIX 08/07 : corrigé double appel isSocketAlive()

import 'dotenv/config';

import express from 'express';
import * as geneseed from './core/geneseed.js';
import * as scheduler from './core/scheduler.js';
import * as memoire from './memory/mongo.js';
import * as heartbeatModule from './core/heartbeat.js';
import * as whatsapp from './channels/whatsapp.js';
import * as telegram from './channels/telegram.js';
import * as immune from './security/immune.js';
import { activateMuscle } from './muscle.js';
import { activateBrain } from './brain.js';
import { cleanNow } from './utils/cleanup.js';

let volonte = null;

function resumerErreur(err) {
  if (err instanceof Error) return err.stack || err.message;
  if (err && typeof err === 'object') {
    const cles = Object.keys(err).join(', ') || 'aucune';
    return `[objet non-Error] constructeur=${err.constructor?.name || '?'} clés=${cles}`;
  }
  return String(err);
}

process.on('unhandledRejection', (reason) => {
  console.error('[SQUELETTE] Rejet promesse non géré :', resumerErreur(reason));
});

process.on('uncaughtException', (err) => {
  console.error('[SQUELETTE] Exception non capturée :', resumerErreur(err));
});

const app = express();
app.get('/ping', (req, res) => res.status(200).send('Gilgamesh is awake'));

app.get('/health', (req, res) => {
  const alive = whatsapp.isSocketAlive ? whatsapp.isSocketAlive() : !!whatsapp.getSocket();
  const volonteStatus = volonte ? volonte.getStatus() : { status: 'non chargé' };
  res.status(200).json({
    status: 'ok',
    whatsapp: alive ? 'connecté' : 'déconnecté',
    telegram: telegram.isAlive() ? 'connecté' : (process.env.TELEGRAM_BOT_TOKEN ? 'déconnecté' : 'non configuré'),
    volonte: volonteStatus,
    uptime: process.uptime(),
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[HTTP] Express sur port ${port} — /ping /health actifs.`);
});

if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gène-seed invalide. Arrêt.');
  heartbeatModule.sang.emit('squelette:exit-imminent', { organe: 'squelette', raison: 'geneseed_invalide' });
  process.exit(1);
}

let _derniereActiviteWhatsApp = Date.now();
let _whatsappDejaTenteRedemarrage = false;

async function boot() {
  immune.activate();
  await memoire.connect();
  console.log('[SQUELETTE] MongoDB connecté.');

  const { sang, start: startHeartbeat } = heartbeatModule;
  startHeartbeat();
  heartbeatModule.setGetSocket(whatsapp.getSocket);

  sang.on('canal:connecte', () => {
    _derniereActiviteWhatsApp = Date.now();
    _whatsappDejaTenteRedemarrage = false;
  });
  sang.on('canal:message:recu', () => { _derniereActiviteWhatsApp = Date.now(); });
  sang.on('reponse:prete', () => { _derniereActiviteWhatsApp = Date.now(); });

  try {
    const { initializeKryvenClient } = await import('./core/kryven-client.js');
    initializeKryvenClient();
  } catch (e) {
    console.error('[SQUELETTE] Kryven init échoué — fallback Mistral :', e.message);
  }

  whatsapp.connect();

  // Optionnel : ne démarre que si TELEGRAM_BOT_TOKEN est présent.
  // N'affecte jamais WhatsApp si absent ou si la connexion échoue (voir
  // channels/telegram.js — jamais de process.exit côté Telegram).
  telegram.connect();

  try {
    volonte = await import('./core/volonte.js');
    console.log('[SQUELETTE] Système Volonté chargé.');
  } catch (e) {
    console.warn('[SQUELETTE] Volonté non chargée :', e.message);
  }

  scheduler.start();
  scheduler.add('nettoyeur-temp', async () => {
    const r = cleanNow();
    if (r.deleted.length) console.log('[THYROIDE] Purge :', r.deleted.length, 'fichiers.');
  }, 60 * 60 * 1000);

  scheduler.add('metabolisme-memoire', async () => {
    sang.emit('nerf:metabolismCheck', {});
  }, 5 * 60 * 1000);

  if (volonte && volonte.execute) {
    scheduler.add('impulsion-volonte', async () => {
      try { await volonte.execute(); } catch (err) {
        console.warn('[THYROIDE] Volonté échouée :', err.message);
      }
    }, 20 * 60 * 1000);
    console.log('[SQUELETTE] Volonté programmée (20min).');
  }

  // FIX 08/07 : corrigé — un seul appel isSocketAlive()
  scheduler.add('keepalive-whatsapp', async () => {
    const alive = whatsapp.isSocketAlive ? whatsapp.isSocketAlive() : !!whatsapp.getSocket();
    if (alive) {
      _derniereActiviteWhatsApp = Date.now();
    } else {
      console.warn('[KEEPALIVE] Socket WhatsApp absente.');
    }
  }, 5 * 60 * 1000);

  scheduler.add('healthcheck-whatsapp', async () => {
    const maintenant = Date.now();
    const inactivite = maintenant - _derniereActiviteWhatsApp;
    const INACTIVITE_MAX = 10 * 60 * 1000;

    if (inactivite > INACTIVITE_MAX) {
      const sock = whatsapp.getSocket();
      if (!sock) {
        console.error('[HEALTHCHECK] WhatsApp déconnecté >10min — reconnexion...');
        _derniereActiviteWhatsApp = maintenant;
        whatsapp.connect();
      } else if (!_whatsappDejaTenteRedemarrage) {
        console.error(`[HEALTHCHECK] WhatsApp zombie — ${Math.floor(inactivite/60000)}min. Redémarrage...`);
        _whatsappDejaTenteRedemarrage = true;
        sang.emit('squelette:exit-imminent', { organe: 'whatsapp', raison: 'zombie_healthcheck', inactiviteMin: Math.floor(inactivite / 60000) });
        setTimeout(() => { console.error('[HEALTHCHECK] Exit forcé.'); process.exit(1); }, 5000);
      }
    }
  }, 2 * 60 * 1000);

  activateMuscle();
  activateBrain();

  console.log('[SQUELETTE] Démarrage OK.');
  sang.emit('squelette:pret', { horodatage: new Date().toISOString() });
}

boot().catch((e) => {
  console.error('[SQUELETTE] Échec critique :', e.message);
  heartbeatModule.sang.emit('squelette:exit-imminent', { organe: 'squelette', raison: 'boot_echoue', detail: e.message });
  process.exit(1);
});

function shutdown(signal) {
  console.log('[SQUELETTE] Signal ' + signal + ' — arrêt...');
  scheduler.stop();
  heartbeatModule.stop();
  if (whatsapp.cleanup) whatsapp.cleanup();
  if (telegram.cleanup) telegram.cleanup();

  memoire.disconnect()
    .then(() => { console.log('[SQUELETTE] Arrêt terminé.'); process.exit(0); })
    .catch(() => { console.log('[SQUELETTE] Arrêt forcé.'); process.exit(0); });

  setTimeout(() => {
    console.error('[SQUELETTE] Timeout.');
    heartbeatModule.sang.emit('squelette:exit-imminent', { organe: 'squelette', raison: 'shutdown_timeout' });
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
