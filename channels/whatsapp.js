// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : parler, écouter. Capte le brut, le passe à l'Estomac pour
// extraction, puis émet sur le Sang. Ne sanitize rien, ne pense rien.
// Voir CODEX, Système 7.
//
// PERSISTANCE GRATUITE : la session WhatsApp est sauvegardée dans MongoDB
// Atlas pour survivre aux redéploiements Render (pas de disque nécessaire).
// Sauvegarde UNIQUEMENT après connection === 'open' (pairing confirmé).

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

// ─── Persistance Session via MongoDB (survit aux redéploiements) ──────

async function waitForDb(timeoutMs = 15000) {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    const db = getDb();
    if (db) return db;
    await new Promise(r => setTimeout(r, 800));
  }
  return null;
}

// Sauvegarde SEULEMENT quand le pairing est confirmé (connection === 'open')
async function saveAuthState() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return;
  const db = await waitForDb();
  if (!db) { console.warn('[WHATSAPP] Mongo pas prêt — session non sauvegardée.'); return; }
  try {
    const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    await db.collection('auth_state').updateOne(
      { _id: 'whatsapp_session' },
      { $set: { creds: credsData, misAJour: new Date() } },
      { upsert: true }
    );
    console.log('[WHATSAPP] Session sauvegardée dans MongoDB.');
  } catch (err) {
    console.warn('[WHATSAPP] Sauvegarde session Mongo échouée :', err.message);
  }
}

async function loadAuthState() {
  const db = getDb();
  if (!db) { console.log('[WHATSAPP] Mongo pas encore connecté — session fraîche.'); return false; }
  try {
    const doc = await db.collection('auth_state').findOne({ _id: 'whatsapp_session' });
    if (!doc || !doc.creds) return false;
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), JSON.stringify(doc.creds, null, 2));
    console.log('[WHATSAPP] Session restaurée depuis MongoDB !');
    return true;
  } catch (err) {
    console.warn('[WHATSAPP] Restauration session Mongo échouée :', err.message);
    return false;
  }
}

// Supprime session locale + MongoDB (après logged out)
async function clearAuthState() {
  // MongoDB
  const db = getDb();
  if (db) {
    try { await db.collection('auth_state').deleteOne({ _id: 'whatsapp_session' }); }
    catch (_) { /* ignore */ }
  }
  // Fichiers locaux
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);
    const preKeysDir = path.join(AUTH_DIR, 'pre-keys');
    if (fs.existsSync(preKeysDir)) fs.rmSync(preKeysDir, { recursive: true, force: true });
    console.log('[WHATSAPP] Auth locale nettoyée.');
  } catch (_) { /* ignore */ }
}

// ─── Handlers extraits (une seule instance, pas de fuite) ─────────────

function requestPairingIfNeeded() {
  if (pairingRequested) return;
  if (!sock) return;
  if (sock.authState && sock.authState.creds && sock.authState.creds.registered) return;
  pairingRequested = true;
  const numero = (process.env.BOT_WHATSAPP_NUMBER || '').replace(/[^\d]/g, '');
  if (numero) {
    const tryPairing = (retry = 0) => {
      sock.requestPairingCode(numero)
        .then(code => console.log('[WHATSAPP] Code de pairing : ' + code))
        .catch(e => {
          if (retry < 2) {
            console.warn('[WHATSAPP] Pairing tentative ' + (retry + 1) + '/3 échouée, retry dans 5s...');
            setTimeout(() => tryPairing(retry + 1), 5000);
          } else {
            console.error('[WHATSAPP] Échec pairing après 3 tentatives :', e.message);
          }
        });
    };
    setTimeout(() => tryPairing(), 4000);
  } else {
    console.warn('[WHATSAPP] BOT_WHATSAPP_NUMBER absent — QR nécessaire.');
  }
}

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;
  const { DisconnectReason } = require('@whiskeysockets/baileys');
  const { Boom } = require('@hapi/boom');

  if (qr) console.log('[WHATSAPP] QR reçu (scan manuel nécessaire comme fallback).');

  if (connection === 'connecting') requestPairingIfNeeded();

  if (connection === 'open') {
    tentatives = 0;
    console.log('[WHATSAPP] Connecté — session valide.');
    sang.emit('canal:connecte', { canal: NOM_CANAL });
    // Sauvegarde immédiate — pairing confirmé, les creds sont valides
    saveAuthState();
  }

  if (connection === 'close') {
    const codeErreur = lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error.output?.statusCode : null;
    const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

    if (dejaDeconnecte) {
      console.error('[WHATSAPP] Session invalide (logged out) — nettoyage et re-pairing.');
      pairingRequested = false;
      clearAuthState();
      return;
    }

    tentatives += 1;
    if (tentatives > MAX_TENTATIVES_RECONNEXION) {
      console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs — Loi 7, on arrête.');
      return;
    }

    console.warn('[WHATSAPP] Connexion perdue — tentative ' + tentatives + '/' + MAX_TENTATIVES_RECONNEXION + '.');
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
      senderId: propre.sender,
      text: propre.text,
      canal: NOM_CANAL,
      messageId: propre.messageId,
      senderName: propre.nomAffiche,
      isGroup,
      groupId: isGroup ? remoteJid : null,
      mediaType: null,
      mediaPath: null,
    });
  }
}

async function handleReponsePrete(payload) {
  try {
    const { target, text, isGroup } = payload;
    if (!sock || !target || !text) { console.warn('[WHATSAPP] Payload réponse incomplet.'); return; }
    const destinataireId = isGroup ? target : target + '@s.whatsapp.net';
    await sock.sendMessage(destinataireId, { text });
    console.log('[WHATSAPP] Réponse envoyée à ' + destinataireId);
  } catch (err) {
    console.error('[WHATSAPP] Erreur envoi réponse :', err.message);
  }
}

// ─── Connexion / Reconnexion ──────────────────────────────────────────

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
      fetchLatestBaileysVersion,
    } = require('@whiskeysockets/baileys');
    const pino = require('pino');

    await loadAuthState();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    saveCredsFn = saveCreds;
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
    });

    // Sauvegarde locale uniquement (fichiers), PAS MongoDB
    sock.ev.on('creds.update', async (creds) => {
      await saveCreds(creds);
    });

    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('messages.upsert', handleMessagesUpsert);

    setupListeners();
    return sock;
  } catch (err) {
    console.error('[WHATSAPP] Échec de connexion :', err.message);
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    return null;
  }
}

function getSocket() {
  return sock;
}

async function cleanup() {
  sang.removeAllListeners('reponse:prete');
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) { /* ignore */ }
    sock = null;
  }
  console.log('[WHATSAPP] Nettoyé proprement.');
}

async function envoyer(destinataireId, texte) {
  if (!sock) { console.error('[WHATSAPP] envoyer() appelé mais pas connecté.'); return false; }
  await sock.sendMessage(destinataireId, { text: texte });
  return true;
}

module.exports = { connect, envoyer, getSocket, cleanup };
