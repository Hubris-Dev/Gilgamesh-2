// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : Worker d'exécution pur (Stateless Node).
// Reçoit sa session via SESSION_BASE64. Aucune génération de QR/Pairing.

import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import AdmZip from 'adm-zip';
import Baileys from '@whiskeysockets/baileys';
// Baileys 6.x exporte { default: makeWASocket, ...noms } en CommonJS.
// `import makeWASocket from '...'` lie makeWASocket à l'objet EXPORTS ENTIER
// (pas à .default) — d'où "makeWASocket is not a function" en prod. Le code
// pré-migration le savait déjà (require + destructuring de .default) ; on
// reproduit le même réflexe ici, juste en syntaxe ESM.
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
// NOUVEAU (diagnostic) : la socket est configurée avec defaultQueryTimeoutMs: 0
// (aucun timeout natif Baileys) — un sendMessage() qui reste bloqué en interne
// n'aurait sinon JAMAIS levé d'erreur : juste un silence indéfini, impossible
// à distinguer d'un redéploiement ou d'un crash externe dans les logs.
const ENVOI_TIMEOUT_MS = 20000;

// RETOUR À BAILEYS 6.7.x (30/07) : sock.signalRepository.lidMapping
// (l'API interne v7 qu'on utilisait pour résoudre les @lid) n'existe pas en
// 6.x. WhatsApp adresse quand même certains contacts en @lid côté serveur,
// indépendamment de la version de Baileys — donc le besoin de résolution
// reste entier. Délégué à baileys-antiban (LidResolver + wrapWithSession-
// Stability), qui apprend le mapping en observant les événements plutôt
// qu'en dépendant d'un store interne spécifique à une version de Baileys.
// Créé UNE fois, au niveau module — pas à chaque connect()/reconnect().
const lidResolver = new LidResolver({ canonical: 'pn' });

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

  // CORRIGÉ (04/08) : Gate ne renvoyait avant que creds.json — jamais keys/
  // (préclés, enregistrements de session Signal). Chaque démarrage recevait
  // donc une session structurellement incomplète, forcée de renégocier une
  // session Signal complète à chaque fois — voir CODEX, notes Gate. Gate
  // renvoie maintenant un ZIP du dossier de session entier. On distingue les
  // deux formats par les octets magiques ZIP ("PK", 0x50 0x4B) plutôt que par
  // un flag externe — SESSION_BASE64 n'est qu'une chaîne brute, aucun moyen
  // de transmettre un flag "format" à côté.
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
        console.warn('[WHATSAPP] ⚠️ Le zip ne contenait que creds.json, pas de fichiers keys/ — session probablement incomplète (cas dégradé côté Gate).');
      }
    } else {
      // Ancien format (rétrocompatibilité) : JSON brut de creds.json seul.
      const parsed = JSON.parse(buffer.toString('utf-8')); // Vérification d'intégrité
      await fs.promises.writeFile(credsPath, JSON.stringify(parsed, null, 2));
      console.warn('[WHATSAPP] Session JSON (ancien format, creds seul) ingérée — pas de keys/, session possiblement incomplète. Régénère un SESSION_BASE64 frais depuis Gate si possible.');
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
    if (!propre) {
      console.log('[WHATSAPP] Message ignoré — pas de key/message exploitable (fromMe, ou événement protocole non-textuel).');
      continue;
    }
    if (!propre.text) {
      console.log(`[WHATSAPP] Message ignoré — texte vide (contenu non géré par extraireTexte : sticker, réaction, média sans légende...). De: ${propre.sender}`);
      continue;
    }

    const remoteJid = msgBrut.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const isChannel = remoteJid.endsWith('@newsletter');

    sang.emit('canal:message:recu', {
      senderId: propre.sender, text: propre.text, canal: NOM_CANAL,
      messageId: propre.messageId, senderName: propre.nomAffiche,
      isGroup, groupId: isGroup ? remoteJid : null,
      isChannel, channelId: isChannel ? remoteJid : null,
      mediaType: null, mediaPath: null,
    });
  }
}

/**
 * ENVOYERAVECTIMEOUT — Course entre sock.sendMessage() et un timeout local.
 */
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
    const { target, text, isGroup, groupId } = payload;
    if (!sock || !target || !text) {
      console.warn(`[WHATSAPP] Envoi abandonné — sock=${!!sock} target=${!!target} text=${!!text}`);
      return;
    }
    // CORRIGÉ (04/08) : `target` est le JID de la personne qui a parlé — pour
    // un message de groupe, c'est le participant individuel, PAS le groupe
    // (voir parseMessageBrute). Avant, on envoyait TOUJOURS à `target`, donc
    // toute réponse à un message de groupe partait en DM privé au lieu de
    // revenir dans le groupe. Si isGroup, la cible réelle est groupId.
    const cible = (isGroup && groupId) ? groupId : target;
    const dest = cible.includes('@') ? cible : cible + '@s.whatsapp.net';
    console.log(`[WHATSAPP] Envoi en cours → ${dest} (${ENVOI_TIMEOUT_MS / 1000}s max)...`);
    await envoyerAvecTimeout(dest, text);
    console.log(`[WHATSAPP] ✓ Message envoyé à ${dest}`);
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

    // baileys-antiban — Session Stability Module. Sur 6.x, pas de store
    // interne pour le mapping LID↔PN (contrairement à v7) : c'est ce module
    // qui apprend le mapping en observant les événements de la socket.
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
    // CORRIGÉ (01/08) : avant, un échec ICI (avant même la toute première
    // connexion réussie) laissait le canal mort pour de bon — connection.update
    // ne se déclenche jamais puisqu'aucun sock valide n'existe, donc reconnect()
    // n'était JAMAIS appelé automatiquement. Le Pouls continuait de battre
    // (le process est vivant) mais WhatsApp restait déconnecté jusqu'à un
    // redéploiement manuel. Même compteur/plafond que la boucle normale.
    tentatives += 1;
    if (tentatives > MAX_TENTATIVES_RECONNEXION) {
      console.error('[WHATSAPP] ' + MAX_TENTATIVES_RECONNEXION + ' échecs au démarrage — arrêt critique.');
      process.exit(1);
    }
    console.warn('[WHATSAPP] Nouvelle tentative dans 5s (' + tentatives + '/' + MAX_TENTATIVES_RECONNEXION + ')...');
    setTimeout(connect, 5000);
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
