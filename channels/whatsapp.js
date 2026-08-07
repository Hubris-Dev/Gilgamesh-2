// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// PATCH 08/2025 — FIX 08/07 : refresh groupMetadata avant envoi groupe

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

// ─── FIX LID/PN (restauré 08/07 — avait disparu dans le refactor "refresh groupMetadata") ───
// WhatsApp adresse certains contacts (surtout en groupe) par LID (@lid) au
// lieu du JID téléphone (@s.whatsapp.net). isWonder() (security/recognition.js)
// compare senderId à ADMIN_IDS en format canonique : sans résolution, un
// message de HUBRIS adressé par LID n'est jamais reconnu comme Wonder.
function resoudreJid(jid) {
  if (!jid) return jid;
  try {
    return lidResolver.resolveCanonical(jid) || jid;
  } catch (err) {
    console.warn('[WHATSAPP] resoudreJid a échoué pour', jid, ':', err.message);
    return jid;
  }
}

// Cache simple pour éviter de refresh les métadonnées à chaque message
const _groupMetaCache = new Map();
const GROUP_META_CACHE_MS = 5 * 60 * 1000; // 5 minutes

// ─── Injection de Session Base64 ───

async function ingestBase64Session() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');

  if (fs.existsSync(credsPath)) {
    console.log('[WHATSAPP] Session locale déjà présente — SESSION_BASE64 ignoré.');
    return;
  }

  const base64Session = process.env.SESSION_BASE64;
  if (!base64Session) {
    console.error('[FATAL] SESSION_BASE64 manquante.');
    process.exit(1);
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const buffer = Buffer.from(base64Session, 'base64');
  const estZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  try {
    if (estZip) {
      const zip = new AdmZip(buffer);
      zip.extractAllTo(AUTH_DIR, true);
    } else {
      const parsed = JSON.parse(buffer.toString('utf-8'));
      await fs.promises.writeFile(credsPath, JSON.stringify(parsed, null, 2));
    }
    console.log('[WHATSAPP] Session ingérée.');
  } catch (err) {
    console.error('[FATAL] SESSION_BASE64 invalide :', err.message);
    process.exit(1);
  }
}

// ─── Handlers ───

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect } = update;

  if (connection === 'open') {
    tentatives = 0;
    console.log('[WHATSAPP] Connecté — worker actif.');
    sang.emit('canal:connecte', { canal: NOM_CANAL });
  }

  if (connection === 'close') {
    const codeErreur = lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error.output?.statusCode
      : lastDisconnect?.error?.output?.statusCode;

    const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

    if (dejaDeconnecte) {
      console.error('[FATAL] Session révoquée.');
      if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
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
  for (const msgBrut of messages) {
    const propre = parseMessageBrute(msgBrut, resoudreJid);
    if (!propre || !propre.text) continue;

    const remoteJid = msgBrut.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const isChannel = remoteJid.endsWith('@newsletter');

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
 * REFRESHGROUPMETADATA — Force Baileys à recharger les clés du groupe.
 * Appelé avant d'envoyer un message dans un groupe, pour éviter "not-acceptable".
 */
async function refreshGroupMetadata(groupId) {
  if (!sock) return;
  
  const cached = _groupMetaCache.get(groupId);
  if (cached && Date.now() - cached < GROUP_META_CACHE_MS) {
    return; // Déjà rafraîchi récemment
  }
  
  try {
    await sock.groupMetadata(groupId);
    _groupMetaCache.set(groupId, Date.now());
  } catch (err) {
    // Silencieux — le groupe n'existe peut-être plus
  }
}

/**
 * ENVOYERAVECTIMEOUT — FIX 08/07
 */
function envoyerAvecTimeout(dest, text, isGroup = false) {
  // FIX : si c'est un groupe, refresh les métadonnées AVANT d'envoyer
  const preEnvoi = isGroup ? refreshGroupMetadata(dest) : Promise.resolve();
  
  return preEnvoi.then(() => 
    Promise.race([
      sock.sendMessage(dest, { text }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout ${ENVOI_TIMEOUT_MS / 1000}s`)),
          ENVOI_TIMEOUT_MS
        )
      ),
    ])
  ).catch(async (err) => {
    const errMsg = err?.message || String(err);
    console.error(`[WHATSAPP] Échec envoi → ${dest}: ${errMsg}`);

    // not-acceptable sur un groupe = les clés ne sont pas à jour.
    // On force un refresh ET on réessaie UNE fois.
    if (errMsg.includes('not-acceptable') && dest.endsWith('@g.us')) {
      console.log(`[WHATSAPP] Tentative refresh metadata pour ${dest}...`);
      try {
        await sock.groupMetadata(dest);
        _groupMetaCache.set(dest, Date.now());
        // Réessayer UNE fois
        await sock.sendMessage(dest, { text });
        console.log(`[WHATSAPP] ✓ Envoi groupe réussi après refresh metadata`);
        return; // Succès !
      } catch (retryErr) {
        console.error(`[WHATSAPP] Échec après refresh: ${retryErr.message}`);
      }
    }

    // Pour les autres erreurs (timeout, réseau), utiliser la Rate
    if (!errMsg.includes('not-acceptable')) {
      try {
        const { queue } = await import('../core/retry-queue.js');
        queue(
          () => sock.sendMessage(dest, { text }),
          { dest, text, canal: NOM_CANAL }
        );
      } catch (_) {}
    }

    throw err;
  });
}

async function handleReponsePrete(payload) {
  try {
    const { target, text, isGroup, groupId } = payload;
    if (!sock || !target || !text) return;

    const cible = (isGroup && groupId) ? groupId : target;
    const dest = cible.includes('@') ? cible : cible + '@s.whatsapp.net';
    const versGroupe = !!(isGroup && groupId);

    console.log(`[WHATSAPP] Envoi → ${dest} groupe=${versGroupe}`);
    await envoyerAvecTimeout(dest, text, versGroupe);
    console.log(`[WHATSAPP] ✓ Message envoyé à ${dest}`);
  } catch (err) {
    console.error(`[WHATSAPP] Échec final : ${err.message}`);
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
      if (isConnecting) { console.error('[WHATSAPP] connect() bloqué 45s — reset.'); isConnecting = false; reconnect(); }
    }, 45000);

    try {
      await ingestBase64Session();
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
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
          badMacThreshold: 3, badMacWindowMs: 60_000,
          onDegraded: (stats) => console.error(`[ANTIBAN] 🔴 ${stats.badMacCount} Bad MAC`),
          onRecovered: () => console.log('[ANTIBAN] 🟢 Récupérée.'),
        },
      });

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', handleConnectionUpdate);
      sock.ev.on('messages.upsert', handleMessagesUpsert);

      // Best-effort : apprentissage des correspondances LID↔PN quand Baileys
      // les expose (fiabilité variable — voir Baileys#2263).
      sock.ev.on('lid-mapping.update', ({ lid, pn } = {}) => {
        if (lid && pn) lidResolver.learn({ lid, pn });
      });

      setupListeners();
      clearTimeout(watchdog);
      return sock;
    } catch (err) {
      clearTimeout(watchdog);
      console.error('[WHATSAPP] Echec connexion :', err.message);
      sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
      tentatives += 1;
      if (tentatives > MAX_TENTATIVES_RECONNEXION) { console.error('[WHATSAPP] Arrêt critique.'); process.exit(1); }
      setTimeout(connect, 5000);
      return null;
    }
  } finally {
    isConnecting = false;
  }
}

function getSocket() { return sock; }
function isSocketAlive() { return !!(sock && sock.user); }

async function cleanup() {
  sang.removeAllListeners('reponse:prete');
  _groupMetaCache.clear();
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { sock.end(new Error('reconnexion')); } catch (_) {}
    sock = null;
  }
}

async function envoyer(destinataire, texte) {
  if (!sock) return false;
  try {
    const jid = destinataire.includes('@') ? destinataire : destinataire + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: texte });
    return true;
  } catch (err) { return false; }
}

export { connect, reconnect, getSocket, isSocketAlive, cleanup, envoyer };
