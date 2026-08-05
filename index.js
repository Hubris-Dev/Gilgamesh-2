// index.js — Système Squelettique
// PATCH 08/2025 :
//   - Intégration du Système Volonté (proactivité)
//   - Healthcheck WhatsApp + auto-restart si zombie
//   - Keep-alive ping WhatsApp périodique
//   - Branchement de la Rate (retry-queue) pour les envois

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

// PATCH : Système Volonté (proactivité)
let volonte = null;

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

// PATCH : endpoint healthcheck étendu
app.get('/health', (req, res) => {
  const sock = whatsapp.getSocket();
  const volonteStatus = volonte ? volonte.getStatus() : { status: 'non chargé' };
  res.status(200).json({
    status: 'ok',
    whatsapp: sock ? 'connecté' : 'déconnecté',
    volonte: volonteStatus,
    uptime: process.uptime(),
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[HTTP] Express Keep-Alive actif sur le port ${port} — Render apaisé.`);
});

if (!geneseed.verify()) {
  console.error('[SQUELETTE] Gène-seed invalide. Arrêt.');
  process.exit(1);
}

// PATCH : Auto-restart si WhatsApp est mort depuis trop longtemps (> 10 minutes)
let _derniereActiviteWhatsApp = Date.now();
let _whatsappDejaTenteRedemarrage = false;

async function boot() {
  immune.activate();
  await memoire.connect();
  console.log('[SQUELETTE] MongoDB connecté.');

  const { sang, start: startHeartbeat } = heartbeatModule;
  startHeartbeat();

  // PATCH : injecter getSocket dans le Pouls pour healthcheck actif
  heartbeatModule.setGetSocket(whatsapp.getSocket);

  // PATCH : Écouter les signaux WhatsApp pour tracker l'activité
  sang.on('canal:connecte', () => {
    _derniereActiviteWhatsApp = Date.now();
    _whatsappDejaTenteRedemarrage = false;
  });

  sang.on('canal:message:recu', () => {
    _derniereActiviteWhatsApp = Date.now();
  });

  sang.on('reponse:prete', () => {
    _derniereActiviteWhatsApp = Date.now();
  });

  try {
    const { initializeKryvenClient } = await import('./core/kryven-client.js');
    initializeKryvenClient();
  } catch (e) {
    console.error('[SQUELETTE] Kryven init échoué — poursuite sur fallback Mistral :', e.message);
  }

  whatsapp.connect();

  // PATCH : Charger le Système Volonté (proactivité)
  try {
    volonte = await import('./core/volonte.js');
    console.log('[SQUELETTE] Système Volonté chargé.');
  } catch (e) {
    console.warn('[SQUELETTE] Volonté non chargée — mode réactif uniquement :', e.message);
  }

  // Scheduler — tâches existantes
  scheduler.start();
  scheduler.add('nettoyeur-temp', async () => {
    const r = cleanNow();
    if (r.deleted.length) console.log('[THYROIDE] Purge :', r.deleted.length, 'fichiers.');
  }, 60 * 60 * 1000);

  scheduler.add('metabolisme-memoire', async () => {
    sang.emit('nerf:metabolismCheck', {});
  }, 5 * 60 * 1000);

  // PATCH : Tâche Volonté — impulsion proactive toutes les 20 minutes
  if (volonte && volonte.execute) {
    scheduler.add('impulsion-volonte', async () => {
      try {
        await volonte.execute();
      } catch (err) {
        console.warn('[THYROIDE] Volonté échouée :', err.message);
      }
    }, 20 * 60 * 1000);
    console.log('[SQUELETTE] Volonté programmée — impulsion toutes les 20 minutes.');
  }

  // PATCH : Keep-alive ping WhatsApp toutes les 5 minutes
  scheduler.add('keepalive-whatsapp', async () => {
    const sock = whatsapp.getSocket();
    if (sock && whatsapp.isSocketAlive()) {
      const state = whatsapp.isSocketAlive() ? 'connecté' : 'zombie';
      console.log(`[KEEPALIVE] WhatsApp socket état: ${state}`);
      _derniereActiviteWhatsApp = Date.now();
    } else {
      console.warn('[KEEPALIVE] Socket WhatsApp absente ou non authentifiée.');
    }
  }, 5 * 60 * 1000);

  // PATCH : Healthcheck WhatsApp — détecte et force reconnexion si zombie
  // Vérifie toutes les 2 minutes si WhatsApp est encore vivant
  scheduler.add('healthcheck-whatsapp', async () => {
    const maintenant = Date.now();
    const inactivite = maintenant - _derniereActiviteWhatsApp;
    const INACTIVITE_MAX = 10 * 60 * 1000; // 10 minutes

    if (inactivite > INACTIVITE_MAX) {
      const sock = whatsapp.getSocket();
      if (!sock) {
        console.error('[HEALTHCHECK] WhatsApp déconnecté depuis plus de 10 minutes — tentative de reconnexion...');
        _derniereActiviteWhatsApp = maintenant;
        whatsapp.connect();
      } else if (!_whatsappDejaTenteRedemarrage) {
        console.error(`[HEALTHCHECK] WhatsApp zombie — ${Math.floor(inactivite / 60000)}min sans activité. Redémarrage forcé...`);
        _whatsappDejaTenteRedemarrage = true;
        _derniereActiviteWhatsApp = maintenant;
        console.error('[HEALTHCHECK] Process.exit(1) dans 5 secondes pour redémarrage Render...');
        setTimeout(() => {
          console.error('[HEALTHCHECK] Redémarrage forcé.');
          process.exit(1);
        }, 5000);
      }
    }
  }, 2 * 60 * 1000);

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
