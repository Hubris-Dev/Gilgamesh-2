// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// PATCH 08/2025 :
//   - Watchdog de connect() corrigé (finally block garantit reset de isConnecting)
//   - Retry Queue branchée : envois échoués passent par retryableWrapper()
//   - Export de isSocketAlive() pour le healthcheck externe
//   - FIX 08/05 : envoyerAvecTimeout corrigé — plus de double log, re-throw après Rate

import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import AdmZip from 'adm-zip';
import Baileys from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = Baileys;
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

// ─── Injection de Session Base64 ───

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

  const buffer = Buffer.from(base64Session, 'base64');
  const estZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  try {
    if (estZip) {
      const zip = new AdmZip(buffer);
      zip.extractAllTo(AUTH_DIR, true);
      const aDesFichiers = fs.existsSync(credsPath);
      const aDesClefs = fs.existsSync(path.join(AUTH_DIR, 'keys')) || fs.readdirSync(AUTH_DIR).some(f => f !== 'creds.json');
      console.log(`[WHATSAPP] Session ZIP dézippée avec succès (premier démarrage) — creds.json: ${aDesFichiers}, autres fichiers (keys): ${aDesClefs}.`);
      if (!aDesClefs) {
        console.warn('[WHATSAPP] ⚠️ Le zip ne contenait que creds.json, pas de fichiers keys/ — session probablement incomplète.');
      }
    } else {
      const parsed = JSON.parse(buffer.toString('utf-8'));
      await fs.promises.writeFile(credsPath, JSON.stringify(parsed, null, 2));
      console.warn('[WHATSAPP] Session JSON (ancien format, creds seul) ingérée — pas de keys/, session possiblement incomplète.');
    }
  } catch (err) {
    console.error('[FATAL] Clé SESSION_BASE64 invalide ou corrompue :', err.message);
    process.exit(1);
  }
}

// ─── Handlers ───

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
    if (!propre) continue;
    if (!propre.text) continue;

    const remoteJid = msgBrut.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const isChannel = remoteJid.endsWith('@newsletter');

    console.log(`[WHATSAPP] remoteJid: ${remoteJid}, isGroup: ${isGroup}, groupId: ${isGroup ? remoteJid : null}`);

    sang.emit('canal:message:recu', {
      senderId: propre.sender,
      text: propre.text,
      canal: NOM_CANAL,
      messageId: propre.messageId,
      senderName: propre.nomAffiche,
      isGroup,
      groupId: isGroup ? remoteJid : null,
      isChannel,
      channelId: isChannel ? remoteJid : null,
      mediaType: null,
      mediaPath: null,
    });
  }
}

/**
 * ENVOYERAVECTIMEOUT — FIX 08/05 :
 * - Ne plus loguer "✓ Message envoyé" si ça a échoué
 * - Si l'envoi échoue avec "not-acceptable", ne PAS mettre en Rate
 *   (réessayer ne changera rien — c'est un refus du serveur, pas un timeout)
 * - Re-throw l'erreur pour que handleReponsePrete sache que ça a échoué
 */
function envoyerAvecTimeout(dest, text) {
  return Promise.race([
    sock.sendMessage(dest, { text }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout ${ENVOI_TIMEOUT_MS / 1000}s`)),
        ENVOI_TIMEOUT_MS
      )
    ),
  ]).catch(async (err) => {
    const errMsg = err?.message || String(err);
    console.error(`[WHATSAPP] ❌ Échec envoi → ${dest}: ${errMsg}`);

    // "not-acceptable" = le serveur WhatsApp refuse ce message.
    // Pas la peine de réessayer via la Rate — ça échouera pareil.
    // Causes possibles : Gilgamesh n'est plus dans le groupe, ou le JID
    // est invalide, ou le format n'est pas accepté.
    if (errMsg.includes('not-acceptable')) {
      console.error(`[WHATSAPP] ⛔ not-acceptable — abandon définitif pour ${dest}. Vérifie que Gilgamesh est bien dans ce groupe.`);
      throw err; // Pas de Rate, on abandonne
    }

    // Pour les autres erreurs (timeout, réseau), utiliser la Rate
    try {
      const { queue } = await import('../core/retry-queue.js');
      queue(
        () => sock.sendMessage(dest, { text }),
        { dest, text, canal: NOM_CANAL }
      );
      console.log(`[WHATSAPP] 🔄 Message mis en file Rate pour ${dest}`);
    } catch (queueErr) {
      console.error('[WHATSAPP] Rate indisponible:', queueErr.message);
    }

    // IMPORTANT : re-throw pour que handleReponsePrete NE logue PAS "✓ Message envoyé"
    throw err;
  });
}

async function handleReponsePrete(payload) {
  try {
    const { target, text, isGroup, groupId, messageId } = payload;
    if (!sock || !target || !text) {
      console.warn(`[WHATSAPP] Envoi abandonné — sock=${!!sock} target=${!!target} text=${!!text}`);
      return;
    }

    const cible = (isGroup && groupId) ? groupId : target;
    const dest = cible.includes('@') ? cible : cible + '@s.whatsapp.net';

    // Log détaillé pour debug groupes
    console.log(`[WHATSAPP] Envoi → dest=${dest} isGroup=${!!isGroup} groupId=${groupId || 'N/A'} target=${target} msgId=${messageId || 'N/A'}`);

    await envoyerAvecTimeout(dest, text);
    console.log(`[WHATSAPP] ✓ Message envoyé à ${dest}`);
  } catch (err) {
    // L'erreur est déjà loggée dans envoyerAvecTimeout
    console.error(`[WHATSAPP] Échec final envoi : ${err.message}`);
  }
}

// ─── Connexion / Reconnexion ───

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

  try {
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
      return sock;
    } catch (err) {
      clearTimeout(watchdog);
      console.error('[WHATSAPP] Echec de connexion :', err.message);
      sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });

      tentatives += 1;
      if (tentatives > MAX_TENTATIVES_RECONNEXION) {
        console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs — arrêt critique.');
        process.exit(1);
      }
      console.warn('[WHATSAPP] Nouvelle tentative dans 5s (' + tentatives + '/' + MAX_TENTATIVES_RECONNEXION + ')...');
      setTimeout(connect, 5000);
      return null;
    }
  } finally {
    isConnecting = false;
  }
}

function getSocket() {
  return sock;
}

function isSocketAlive() {
  return !!(sock && sock.user);
}

async function cleanup() {
  sang.removeAllListeners('reponse:prete');
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { sock.end(new Error('reconnexion')); } catch (_) {}
    sock = null;
  }
  console.log('[WHATSAPP] Nettoyé proprement.');
}

async function envoyer(destinataire, texte, isGroup = false) {
  if (!sock) { console.warn('[WHATSAPP] Socket absent.'); return false; }
  try {
    const jid = destinataire.includes('@') ? destinataire : destinataire + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: texte });
    return true;
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi :', err.message);
    return false;
  }
}

export { connect, reconnect, getSocket, isSocketAlive, cleanup, envoyer };
