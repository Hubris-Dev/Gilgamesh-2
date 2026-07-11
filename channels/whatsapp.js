// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : parler, écouter. Capte le brut, le passe à l'Estomac pour
// extraction, puis émet sur le Sang. Ne sanitize rien, ne pense rien.
// Voir CODEX, Système 7.
//
// PERSISTANCE — La session est mirrorée vers MongoDB sur CHAQUE creds.update,
// pas seulement sur 'open'. Restauration non bloquante au démarrage.
// Plus de waitForDb(), plus de dépendance MongoDB avant connexion.

const path = require('node:path');
const fs = require('node:fs');
const { sang } = require('../core/heartbeat');
const { parseMessageBrute } = require('../utils/parser');
const { getDb } = require('../memory/mongo');

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 5;
const AUTH_DIR = path.join(process.cwd(), 'auth');

let sock = null;
let tentatives = 0;
let saveCredsFn = null;
let pairingRequested = false;

// ─── Persistance MongoDB (best effort, non bloquant) ───

/** Essaye de restaurer la session depuis MongoDB. Silencieux si Mongo absent. */
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

/** Mirror la session locale vers MongoDB. Silencieux si Mongo absent. */
async function mirrorToMongo() {
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

/** Nettoie session locale + MongoDB. */
async function clearAuthState() {
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
    sock.requestPairingCode(numero)
      .then(code => console.log('[WHATSAPP] Code de pairing : ' + code))
      .catch(e => {
        if (retry < 2) {
          console.warn('[WHATSAPP] Pairing tentative ' + (retry + 1) + '/3 échouée, retry 5s...');
          setTimeout(() => tryPairing(retry + 1), 5000);
        } else {
          console.error('[WHATSAPP] Échec pairing après 3 tentatives :', e.message);
        }
      });
  };
  setTimeout(() => tryPairing(), 4000);
}

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;
  const { DisconnectReason } = require('@whiskeysockets/baileys');
  const { Boom } = require('@hapi/boom');

  if (qr) console.log('[WHATSAPP] QR reçu (fallback scan manuel).');

  if (connection === 'connecting') requestPairingIfNeeded();

  if (connection === 'open') {
    tentatives = 0;
    console.log('[WHATSAPP] Connecté — session valide.');
    sang.emit('canal:connecte', { canal: NOM_CANAL });
  }

  if (connection === 'close') {
    const codeErreur = lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error.output?.statusCode : null;
    const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

    if (dejaDeconnecte) {
      console.error('[WHATSAPP] Session invalide (logged out) — nettoyage + re-pairing.');
      pairingRequested = false;
      clearAuthState();
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
  await new Promise(r => setTimeout(r, 3000));
  connect();
}

async function connect() {
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
      fetchLatestBaileysVersion,
    } = require('@whiskeysockets/baileys');
    const pino = require('pino');

    // Restauration non bloquante
    restoreFromMongo();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    saveCredsFn = saveCreds;
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      logger: pino({ level: 'fatal' }),
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
    });

    // Sauvegarde locale + mirror MongoDB à CHAQUE creds.update
    sock.ev.on('creds.update', async (creds) => {
      await saveCreds(creds);
      mirrorToMongo().catch(() => {});
    });

    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('messages.upsert', handleMessagesUpsert);

    setupListeners();
    return sock;
  } catch (err) {
    console.error('[WHATSAPP] Échec connexion :', err.message);
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    return null;
  }
}

function getSocket() { return sock; }

async function cleanup() {
  sang.removeAllListeners('reponse:prete');
  if (sock) { try { sock.ev.removeAllListeners(); } catch (_) {} sock = null; }
}

async function envoyer(destinataire, texte) {
  if (!sock) return false;
  try { await sock.sendMessage(destinataire, { text: texte }); return true; }
  catch (err) { console.error('[WHATSAPP] Erreur envoi :', err.message); return false; }
}

module.exports = { connect, reconnect, getSocket, cleanup, envoyer };
