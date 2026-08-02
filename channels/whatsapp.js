// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : Worker d'exécution pur (Stateless Node).
// Reçoit sa session via SESSION_BASE64. Aucune génération de QR/Pairing.

import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import * as baileys from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = baileys;
import { wrapWithSessionStability, LidResolver } from 'baileys-antiban';
import { sang } from '../core/heartbeat.js';
import { parseMessageBrute } from '../utils/parser.js';

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 10;
const AUTH_DIR = path.join(process.cwd(), 'auth');
const ENVOI_TIMEOUT_MS = 20000;

const lidResolver = new LidResolver({ canonical: 'pn' });

let sock = null;
let tentatives = 0;
let isConnecting = false;

async function ingestBase64Session() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (fs.existsSync(credsPath)) {
    console.log('[WHATSAPP] Session locale déjà présente — SESSION_BASE64 ignoré (évite un rollback).');
    return;
  }

  const base64Session = process.env.SESSION_BASE64;
  if (!base64Session) {
    console.error('[FATAL] Variable d\'environnement SESSION_BASE64 manquante.');
    process.exit(1);
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  try {
    const credsBuffer = Buffer.from(base64Session, 'base64');
    const parsed = JSON.parse(credsBuffer.toString('utf-8'));
    await fs.promises.writeFile(credsPath, JSON.stringify(parsed, null, 2));
    console.log('[WHATSAPP] Clé Base64 ingérée et validée avec succès (premier démarrage).');
  } catch (err) {
    console.error('[FATAL] Clé SESSION_BASE64 invalide ou corrompue :', err.message);
    process.exit(1);
  }
}

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect } = update;

  if (connection === 'open') {
    tentatives = 0;
    console.log('[WHATSAPP] Connecté — worker actif.');
    if (sock?.sessionHealthStats) {
      console.log('[ANTIBAN]', JSON.stringify(sock.sessionHealthStats));
    }
    sang.emit('canal:connecte', { canal: NOM_CANAL });
  }

  if (connection === 'close') {
    const codeErreur = lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error.output?.statusCode
      : lastDisconnect?.error?.output?.statusCode;

    const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

    if (dejaDeconnecte) {
      console.error('[FATAL] Session révoquée (logged out). Nettoyage de l\'état et auto-destruction.');
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      process.exit(1);
    }

    tentatives += 1;
    if (tentatives > MAX_TENTATIVES_RECONNEXION) {
      console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs — arrêt critique.');
      process.exit(1);
    }
    console.warn('[WHATSAPP] Connexion perdue — tentative ' + tentatives + '/' + MAX_TENTATIVES_RECONNEXION);
    reconnect();
  }
}

function handleMessagesUpsert({ messages, type }) {
  console.log(`[WHATSAPP] messages.upsert reçu — type: ${type}, count: ${messages?.length || 0}`);
  for (const msgBrut of messages) {
    const propre = parseMessageBrute(msgBrut);
    if (!propre) {
      console.log('[WHATSAPP] Message ignoré — pas de key/message exploitable (fromMe, ou événement protocole non-textuel).');
      continue;
    }
    if (!propre.text) {
      console.log(`[WHATSAPP] Message ignoré — texte vide. De: ${propre.sender}`);
      continue;
    }

    const remoteJid = msgBrut.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');

    sang.emit('canal:message:recu', {
      senderId: propre.sender, text: propre.text, canal: NOM_CANAL,
      messageId: propre.messageId, senderName: propre.nomAffiche,
      isGroup, groupId: isGroup ? remoteJid : null,
      mediaType: null, mediaPath: null,
    });
  }
}

function envoyerAvecTimeout(dest, text) {
  return Promise.race([
    sock.sendMessage(dest, { text }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout ${ENVOI_TIMEOUT_MS / 1000}s — sendMessage() n'a jamais répondu pour ${dest}`)),
        ENVOI_TIMEOUT_MS
      )
    ),
  ]);
}

async function handleReponsePrete(payload) {
  console.log(`[WHATSAPP] reponse:prete reçu du Sang — target=${payload?.target || '?'}`);
  try {
    const { target, text, isGroup } = payload;
    if (!sock || !target || !text) {
      console.warn(`[WHATSAPP] Envoi abandonné — sock=${!!sock} target=${!!target} text=${!!text}`);
      return;
    }
    const dest = target.includes('@') ? target : target + '@s.whatsapp.net';
    console.log(`[WHATSAPP] Envoi en cours → ${dest} (${ENVOI_TIMEOUT_MS / 1000}s max)...`);
    await envoyerAvecTimeout(dest, text);
    console.log(`[WHATSAPP] ✓ Message envoyé à ${dest}`);
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi :', err.message);
  }
}

function setupListeners() {
  sang.removeAllListeners('reponse:prete');
  sang.on('reponse:prete', handleReponsePrete);
}

async function reconnect() {
  await cleanup();
  await new Promise(r => setTimeout(r, 5000));
  connect();
}

async function connect() {
  if (isConnecting) {
    console.warn('[WHATSAPP] Connexion déjà en cours — ignoré.');
    return null;
  }
  isConnecting = true;

  const watchdog = setTimeout(() => {
    if (isConnecting) {
      console.error('[WHATSAPP] connect() bloqué depuis 45s — reset forcé.');
      isConnecting = false;
      reconnect();
    }
  }, 45000);

  try {
    await ingestBase64Session();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 120000,
      defaultQueryTimeoutMs: 0,
    });

    sock = wrapWithSessionStability(sock, {
      canonicalJidNormalization: true,
      healthMonitoring: true,
      lidResolver,
      health: {
        badMacThreshold: 3,
        badMacWindowMs: 60_000,
        onDegraded: (stats) => {
          console.error(`[ANTIBAN] 🔴 Session dégradée : ${stats.badMacCount} Bad MAC en 60s`);
        },
        onRecovered: () => {
          console.log('[ANTIBAN] 🟢 Session récupérée.');
        },
      },
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('messages.upsert', handleMessagesUpsert);

    setupListeners();
    clearTimeout(watchdog);
    isConnecting = false;
    return sock;
  } catch (err) {
    clearTimeout(watchdog);
    console.error('[WHATSAPP] Echec de connexion :', err.message);
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    isConnecting = false;

    // Compter cette tentative comme une déconnexion et retenter avec backoff
    tentatives += 1;
    if (tentatives > MAX_TENTATIVES_RECONNEXION) {
      console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs — arrêt critique.');
      process.exit(1);
    }

    const delayMs = Math.min(5000 * tentatives, 60_000); // backoff linéaire limité à 60s
    console.warn(`[WHATSAPP] Nouvelle tentative dans ${delayMs/1000}s (tentative ${tentatives}/${MAX_TENTATIVES_RECONNEXION})`);
    setTimeout(() => { reconnect(); }, delayMs);

    return null;
  }
}

function getSocket() {
  return sock;
}

async function cleanup() {
  sang.removeAllListeners('reponse:prete');
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { sock.end(new Error('reconnexion — fermeture du socket précédent')); } catch (_) {}
    sock = null;
  }
  console.log('[WHATSAPP] Nettoyé proprement.');
}

async function envoyer(destinataire, texte, isGroup = false) {
  if (!sock) { console.warn('[WHATSAPP] Socket absent — envoi impossible.'); return false; }
  try {
    const jid = destinataire.includes('@') ? destinataire : destinataire + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: texte });
    return true;
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi :', err.message);
    return false;
  }
}

export { connect, reconnect, getSocket, cleanup, envoyer };