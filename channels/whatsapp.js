// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : parler, écouter. Capte le brut, le passe à l'Estomac (utils/parser.js)
// pour extraction, puis émet sur le Sang. Ne sanitize rien, ne pense rien.
// Voir CODEX, Système 7.
//
// Loi 7 — Mourir Proprement : après plusieurs échecs de reconnexion,
// on laisse la session mourir plutôt que de retry à l'infini toutes les 15s.
//
// Organe de Larraman (Partie 3) : try/catch à son point d'entrée — une
// panne ici ne doit jamais faire tomber tout le process (Loi 4).
//
// NOTE HONNÊTETÉ : je n'ai pas de réseau dans mon bash pour tester ça contre
// un vrai serveur WhatsApp — j'ai vérifié l'API Baileys actuelle par
// recherche web, mais certains détails fins (ex: le chemin exact de
// authState.creds.registered) sont à confirmer au premier lancement réel.

const path = require('node:path');
const { sang } = require('../core/heartbeat');
const { parseMessageBrute } = require('../utils/parser');

const NOM_CANAL = 'whatsapp';
const MAX_TENTATIVES_RECONNEXION = 5;

let sock = null;
let tentatives = 0;

async function connect() {
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      DisconnectReason,
    } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');
    const pino = require('pino');

    const dossierAuth = path.join(process.cwd(), 'auth');
    const { state, saveCreds } = await useMultiFileAuthState(dossierAuth);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // Pairing code si pas encore enregistré — évite d'avoir besoin d'un
    // écran pour scanner un QR (workflow Termux déjà utilisé).
    if (!sock.authState.creds.registered) {
      const numero = (process.env.BOT_WHATSAPP_NUMBER || '').replace(/[^\d]/g, '');
      if (numero) {
        const code = await sock.requestPairingCode(numero);
        console.log(`[WHATSAPP] Code de pairing : ${code}`);
      } else {
        console.warn('[WHATSAPP] BOT_WHATSAPP_NUMBER absent — QR nécessaire, pas de pairing code possible.');
      }
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

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
          console.error('[WHATSAPP] Session déconnectée (logged out) — re-pairing nécessaire, pas de retry.');
          return;
        }

        tentatives += 1;
        if (tentatives > MAX_TENTATIVES_RECONNEXION) {
          console.error(`[WHATSAPP] ${MAX_TENTATIVES_RECONNEXION} échecs — Loi 7, on arrête. Redémarrage manuel nécessaire.`);
          return;
        }

        console.warn(`[WHATSAPP] Connexion perdue — tentative ${tentatives}/${MAX_TENTATIVES_RECONNEXION}.`);
        connect();
      }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msgBrut of messages) {
        const propre = parseMessageBrute(msgBrut);
        if (!propre || !propre.text) continue;

        sang.emit('canal:message:recu', {
          senderId: propre.sender,
          text: propre.text,
          canal: NOM_CANAL,
        });
      }
    });

    return sock;
  } catch (err) {
    console.error('[WHATSAPP] Échec de connexion :', err.message);
    sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    return null;
  }
}

async function envoyer(destinataireId, texte) {
  if (!sock) {
    console.error('[WHATSAPP] envoyer() appelé mais pas encore connecté.');
    return false;
  }
  await sock.sendMessage(destinataireId, { text: texte });
  return true;
}

module.exports = { connect, envoyer };
