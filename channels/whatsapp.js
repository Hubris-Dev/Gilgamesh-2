// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : parler, écouter. Capte le brut, le passe à l'Estomac (utils/parser.js)
// pour extraction, puis émet sur le Sang. Ne sanitize rien, ne pense rien.
// Voir CODEX, Système 7.
//
// CORRIGÉ : le handler connection.update est extrait de connect() pour éviter
// la fuite de listeners à chaque reconnexion. getSocket() exposé pour le Muscle.

const path = require('node:path');
const { sang } = require('../core/heartbeat');
const { parseMessageBrute } = require('../utils/parser');

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 5;

let sock = null;
let tentatives = 0;
let saveCredsFn = null;

// ── Handlers extraits (une seule instance, pas de fuite) ──────────

function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    const { DisconnectReason } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');

    if (qr) {
        console.log('[WHATSAPP] QR reçu (scan manuel nécessaire).');
    }

    if (connection === 'open') {
        tentatives = 0;
        console.log('[WHATSAPP] Connecté.');
        sang.emit('canal:connecte', { canal: NOM_CANAL });
    }

    if (connection === 'close') {
        const codeErreur = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : null;
        const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

        sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: lastDisconnect?.error?.message });

        if (dejaDeconnecte) {
            console.error('[WHATSAPP] Session déconnectée (logged out) — re-pairing nécessaire.');
            return;
        }

        tentatives += 1;
        if (tentatives > MAX_TENTATIVES_RECONNEXION) {
            console.error(`[WHATSAPP] ${MAX_TENTATIVES_RECONNEXION} échecs — Loi 7, on arrête.`);
            return;
        }

        console.warn(`[WHATSAPP] Connexion perdue — tentative ${tentatives}/${MAX_TENTATIVES_RECONNEXION}.`);
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
        if (!sock || !target || !text) {
            console.warn('[WHATSAPP] Payload réponse incomplet ou socket fermé.');
            return;
        }

        const destinataireId = isGroup ? target : `${target}@s.whatsapp.net`;
        await sock.sendMessage(destinataireId, { text });
        console.log(`[WHATSAPP] Réponse envoyée à ${destinataireId}`);
    } catch (err) {
        console.error("[WHATSAPP] Erreur lors de l'envoi de la réponse :", err.message);
    }
}

// ── Connexion / Reconnexion ────────────────────────────────────────

async function connect() {
    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            fetchLatestBaileysVersion,
        } = require('@whiskeysockets/baileys');
        const pino = require('pino');

        const dossierAuth = path.join(process.cwd(), 'auth');
        const { state, saveCreds } = await useMultiFileAuthState(dossierAuth);
        const { version } = await fetchLatestBaileysVersion();

        saveCredsFn = saveCreds;

        if (sock) {
            try { sock.end(); } catch (_) { /* ignore */ }
        }

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCredsFn);
        sock.ev.on('connection.update', handleConnectionUpdate);
        sock.ev.on('messages.upsert', handleMessagesUpsert);
        sang.on('reponse:prete', handleReponsePrete);

        if (!sock.authState.creds.registered) {
            const numero = (process.env.BOT_WHATSAPP_NUMBER || '').replace(/[^\d]/g, '');
            if (numero) {
                const code = await sock.requestPairingCode(numero);
                console.log(`[WHATSAPP] Code de pairing : ${code}`);
            } else {
                console.warn('[WHATSAPP] BOT_WHATSAPP_NUMBER absent — QR nécessaire.');
            }
        }

        return sock;
    } catch (err) {
        console.error('[WHATSAPP] Échec de connexion :', err.message);
        sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
        return null;
    }
}

async function reconnect() {
    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            fetchLatestBaileysVersion,
        } = require('@whiskeysockets/baileys');
        const pino = require('pino');

        const dossierAuth = path.join(process.cwd(), 'auth');
        const { state, saveCreds } = await useMultiFileAuthState(dossierAuth);
        const { version } = await fetchLatestBaileysVersion();

        saveCredsFn = saveCreds;

        if (sock) {
            try { sock.ev.removeAllListeners(); sock.end(); } catch (_) { /* ignore */ }
        }

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCredsFn);
        sock.ev.on('connection.update', handleConnectionUpdate);
        sock.ev.on('messages.upsert', handleMessagesUpsert);

        if (!sock.authState.creds.registered) {
            const numero = (process.env.BOT_WHATSAPP_NUMBER || '').replace(/[^\d]/g, '');
            if (numero) {
                const code = await sock.requestPairingCode(numero);
                console.log(`[WHATSAPP] Code de pairing : ${code}`);
            }
        }

        return sock;
    } catch (err) {
        console.error('[WHATSAPP] Échec reconnexion :', err.message);
        return null;
    }
}

function getSocket() {
    return sock;
}

async function envoyer(destinataireId, texte) {
    if (!sock) {
        console.error('[WHATSAPP] envoyer() appelé mais pas encore connecté.');
        return false;
    }
    await sock.sendMessage(destinataireId, { text: texte });
    return true;
}

function cleanup() {
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.end(); } catch (_) { /* ignore */ }
        sock = null;
    }
    sang.removeListener('reponse:prete', handleReponsePrete);
}

module.exports = { connect, envoyer, getSocket, cleanup };
