// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : parler, écouter. Capte le brut, le passe à l'Estomac pour
// extraction, puis émet sur le Sang. Ne sanitize rien, ne pense rien.
// Voir CODEX, Système 7.
//
// PERSISTANCE — La session est mirrorée vers MongoDB sur CHAQUE creds.update,
// pas seulement sur 'open'. Restauration non bloquante au démarrage.
// CacheableSignalKeyStore, timeouts explicites, browser config validée
// pour pairing code (voir Baileys issue #328).

const path = require('node:path');
const fs = require('node:fs');
const { sang } = require('../core/heartbeat');
const { parseMessageBrute } = require('../utils/parser');
const { getDb } = require('../memory/mongo');

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 10;
const AUTH_DIR = path.join(process.cwd(), 'auth');

let sock = null;
let tentatives = 0;
let saveCredsFn = null;
let pairingRequested = false;
let isConnecting = false;   // Bloque les connect() concurrents
let isClearing = false;     // Bloque mirrorToMongo pendant un nettoyage

// ─── Persistance MongoDB (best effort, non bloquant) ───

async function restoreFromMongo() {
  const db = getDb();
  if (!db) return false;
  try {
    const doc = await db.collection('auth_state').findOne({ _id: 'whatsapp_session' });
    if (!doc || !doc.creds) return false;
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), JSON.stringify(doc.creds, null, 2));
    console.log('[WHATSAPP] Session restaurée depuis MongoDB.');
    return true;
  } catch (_) { return false; }
}

async function mirrorToMongo() {
  if (isClearing) return; // Ne pas mirror si on est en train de nettoyer
  const db = getDb();
  if (!db) return;
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return;
  try {
    const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    await db.collection('auth_state').updateOne(
      { _id: 'whatsapp_session' },
      { $set: { creds: credsData, misAJour: new Date() } },
      { upsert: true }
    );
  } catch (_) { /* silencieux */ }
}

async function clearAuthState() {
  isClearing = true;
  const db = getDb();
  if (db) {
    try { await db.collection('auth_state').deleteOne({ _id: 'whatsapp_session' }); } catch (_) {}
  }
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);
    const preKeysDir = path.join(AUTH_DIR, 'pre-keys');
    if (fs.existsSync(preKeysDir)) fs.rmSync(preKeysDir, { recursive: true, force: true });
  } catch (_) {}
  isClearing = false;
}

// ─── Handlers ───

function requestPairingIfNeeded() {
  if (pairingRequested) return;
  if (!sock) return;
  if (sock.authState?.creds?.registered) return;
  pairingRequested = true;
  const numero = (process.env.BOT_WHATSAPP_NUMBER || '').replace(/[^\d]/g, '');
  if (!numero) { console.warn('[WHATSAPP] BOT_WHATSAPP_NUMBER absent — QR nécessaire.'); return; }

  const tryPairing = (retry = 0) => {
    if (!sock) return;
    sock.requestPairingCode(numero)
      .then(code => {
        console.log('[WHATSAPP] Code de pairing : ' + code);
        sang.emit('canal:pairing', { canal: NOM_CANAL, code });
      })
      .catch(e => {
        if (retry < 2 && sock) {
          console.warn('[WHATSAPP] Pairing tentative ' + (retry + 1) + '/3 échouée, retry 5s...');
          setTimeout(() => tryPairing(retry + 1), 5000);
        } else {
          console.error('[WHATSAPP] Echec pairing après 3 tentatives :', e.message);
          pairingRequested = false;
        }
      });
  };
  tryPairing();
}

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;

  // Appel sur QR (comme l'exemple officiel) — le socket est PRÊT à ce moment
  if (qr) {
    console.log('[WHATSAPP] QR reçu — socket prêt, demande pairing...');
    requestPairingIfNeeded();
  }

  if (connection === 'open') {
    tentatives = 0;
    console.log('[WHATSAPP] Connecté — session valide.');
    sang.emit('canal:connecte', { canal: NOM_CANAL });
    mirrorToMongo();
  }

  if (connection === 'close') {
    const { DisconnectReason } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');
    const codeErreur = lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error.output?.statusCode : null;
    const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

    if (dejaDeconnecte) {
      console.warn('[WHATSAPP] Session invalide (logged out) — nettoyage + re-pairing.');
      pairingRequested = false;
      clearAuthState().then(() => {
        isConnecting = false;
        reconnect();
      });
      return;
    }

    tentatives += 1;
    if (tentatives > MAX_TENTATIVES_RECONNEXION) {
      console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs — arrêt (Loi 7).');
      return;
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
  // Bloque les appels concurrents
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

    await restoreFromMongo();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    saveCredsFn = saveCreds;
    const { version } = await fetchLatestBaileysVersion();

    // Browser config validée pour pairing code (Baileys issue #328)
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Chrome (Linux)', '', ''],
      markOnlineOnConnect: true,
      connectTimeoutMs: 120000,
      defaultQueryTimeoutMs: 0,
    });

    sock.ev.on('creds.update', async (creds) => {
      await saveCreds(creds);
      mirrorToMongo().catch(() => {});
    });

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
