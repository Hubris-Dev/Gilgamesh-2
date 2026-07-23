// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : Worker d'exécution pur (Stateless Node).
// Reçoit sa session via SESSION_BASE64. Aucune génération de QR/Pairing.

const path = require('node:path');
const fs = require('node:fs');
const { sang } = require('../core/heartbeat');
const { parseMessageBrute } = require('../utils/parser');

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 10;
const AUTH_DIR = path.join(process.cwd(), 'auth');

let sock = null;
let tentatives = 0;
let isConnecting = false;   // Bloque les connect() concurrents

// ─── Injection de Session Base64 ───

async function ingestBase64Session() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');

  // BUG CORRIGÉ : avant, cette fonction tournait à CHAQUE connect() — y compris
  // à chaque reconnexion. Ça réécrivait creds.json avec le SESSION_BASE64 figé
  // de l'env var, effaçant les clés de session à jour que Baileys venait de
  // sauvegarder (via saveCreds). Ce rollback désynchronise le chiffrement
  // Signal et finit par faire révoquer la session par WhatsApp (Bad MAC / 401).
  // Maintenant : on n'ingère QUE s'il n'existe encore aucune session locale.
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
    const parsed = JSON.parse(credsBuffer.toString('utf-8')); // Vérification d'intégrité
    await fs.promises.writeFile(credsPath, JSON.stringify(parsed, null, 2));
    console.log('[WHATSAPP] Clé Base64 ingérée et validée avec succès (premier démarrage).');
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
    sang.emit('canal:connecte', { canal: NOM_CANAL });
  }

  if (connection === 'close') {
    const { DisconnectReason } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');

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

function handleMessagesUpsert({ messages }) {
  for (const msgBrut of messages) {
    const propre = parseMessageBrute(msgBrut);
    if (!propre || !propre.text) continue;

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

async function handleReponsePrete(payload) {
  try {
    const { target, text, isGroup } = payload;
    if (!sock || !target || !text) return;
    const dest = isGroup ? target : target + '@s.whatsapp.net';
    await sock.sendMessage(dest, { text });
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi :', err.message);
  }
}

// ─── Connexion / Reconnexion ───

function setupListeners() {
  sang.removeAllListeners('reponse:prete');
  sang.on('reponse:prete', handleReponsePrete);
}

async function reconnect() {
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
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
      fetchLatestBaileysVersion,
    } = require('@whiskeysockets/baileys');
    const pino = require('pino');

    // 1. Injection UNIQUEMENT si aucune session locale n'existe déjà
    await ingestBase64Session();

    // 2. Initialisation
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

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('messages.upsert', handleMessagesUpsert);

    setupListeners();
    isConnecting = false;
    return sock;
  } catch (err) {
    console.error('[WHATSAPP] Echec de connexion :', err.message);
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    isConnecting = false;
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
    sock = null;
  }
  console.log('[WHATSAPP] Nettoyé proprement.');
}

async function envoyer(destinataire, texte, isGroup = false) {
  if (!sock) { console.warn('[WHATSAPP] Socket absent — envoi impossible.'); return false; }
  try {
    const jid = isGroup ? destinataire : destinataire + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: texte });
    return true;
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi :', err.message);
    return false;
  }
}

module.exports = { connect, reconnect, getSocket, cleanup, envoyer };
