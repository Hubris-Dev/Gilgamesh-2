// channels/whatsapp.js
// Système Respiratoire — Canal WhatsApp (Baileys)
// RÔLE : Worker d'exécution pur (Stateless Node).
// Reçoit sa session via SESSION_BASE64. Aucune génération de QR/Pairing.

import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { sang } from '../core/heartbeat.js';
import { parseMessageBrute } from '../utils/parser.js';

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
  //
  // IMPORTANT (upgrade v7) : une session/creds.json générée sous Baileys 6.x
  // ne contient pas les clés lid-mapping / device-list / tctoken que
  // useMultiFileAuthState() v7 attend. Après cet upgrade, régénère un
  // SESSION_BASE64 frais via un ré-appairage (Termux) plutôt que de réutiliser
  // l'ancien — sinon la session risque d'être rejetée ou incomplète au démarrage.
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

    sang.emit('canal:message:recu', {
      senderId: propre.sender, text: propre.text, canal: NOM_CANAL,
      messageId: propre.messageId, senderName: propre.nomAffiche,
      isGroup, groupId: isGroup ? remoteJid : null,
      mediaType: null, mediaPath: null,
    });
  }
}

/**
 * RESOUDRE_JID_REEL — Convertit un pseudo-JID @lid en vrai JID téléphone
 * (@s.whatsapp.net) avant l'envoi.
 *
 * CONTEXTE (bug Baileys documenté #1718, #1964, résolu par la lib en v7) :
 * WhatsApp adresse certains contacts via un identifiant privé @lid plutôt
 * que le numéro réel. Envoyer un message DIRECTEMENT à ce pseudo-JID
 * "réussit" côté code (sock.sendMessage ne lève aucune erreur) mais le
 * message reste bloqué "En attente..." côté destinataire et n'arrive jamais.
 *
 * Baileys v7 (>= rc.1) expose enfin le store interne pour ce mapping :
 * sock.signalRepository.lidMapping, avec getPNForLID / getLIDForPN /
 * storeLIDPNMapping(s) / getLIDsForPNs (voir guide de migration officiel,
 * https://baileys.wiki/docs/migration/to-v7.0.0/). C'est la méthode utilisée
 * ci-dessous.
 *
 * LIMITE CONNUE (issue #2133) : getPNForLID peut renvoyer null si le mapping
 * n'a pas encore été appris par le client (le contact n'a pas encore envoyé
 * de message "normal" observé par cette session) — dans ce cas on retombe
 * sur le LID brut, au même risque de non-livraison qu'avant. Pas de solution
 * garantie à 100% côté client documentée à ce jour pour ce cas précis.
 *
 * CORRIGÉ (26/07) : quand getPNForLID renvoie un JID AVEC suffixe d'appareil
 * (ex. "50944480499:0@s.whatsapp.net"), l'envoi était accepté sans erreur
 * mais jamais livré — même signature silencieuse que le problème LID
 * d'origine, juste une couche plus bas. Le suffixe est retiré avant tout
 * envoi.
 */
async function resoudreJidReel(jid) {
  if (!jid || !jid.endsWith('@lid')) return jid;

  try {
    const lidStore = sock?.signalRepository?.lidMapping;
    if (lidStore?.getPNForLID) {
      const pn = await lidStore.getPNForLID(jid);
      if (pn) {
        // CORRIGÉ : getPNForLID peut renvoyer un JID avec suffixe d'appareil
        // (ex. "50944480499:0@s.whatsapp.net") — vu en prod le 26/07, message
        // "envoyé" sans erreur mais jamais livré. La forme canonique pour
        // sendMessage() est SANS ce suffixe (comparer avec des libs tierces
        // de canonicalisation LID qui retirent systématiquement ce ":N" avant
        // envoi). On le retire ici, une seule fois, au bon endroit — pas à
        // chaque appelant.
        const pnCanonique = pn.replace(/:\d+(?=@)/, '');
        if (pnCanonique !== pn) {
          console.log(`[WHATSAPP] Suffixe d'appareil retiré : ${pn} → ${pnCanonique}`);
        }
        console.log(`[WHATSAPP] LID résolu → JID réel : ${jid} → ${pnCanonique}`);
        return pnCanonique;
      }
    }
  } catch (err) {
    console.warn('[WHATSAPP] Résolution LID→PN a échoué :', err.message);
  }

  console.warn(`[WHATSAPP] ⚠️ Impossible de résoudre le vrai JID pour ${jid} — envoi tenté sur le LID brut (mapping pas encore appris par cette session, voir issue Baileys #2133).`);
  return jid;
}

async function handleReponsePrete(payload) {
  try {
    const { target, text, isGroup } = payload;
    if (!sock || !target || !text) return;
    // Le JID peut déjà être complet (@s.whatsapp.net, @g.us, ou le format
    // récent @lid) — ne JAMAIS ajouter @s.whatsapp.net s'il y a déjà un
    // suffixe, sinon on obtient un JID cassé du type "xxxx@lid@s.whatsapp.net"
    // que Baileys ne peut pas chiffrer — ça casse la socket au lieu de juste
    // lever une erreur JS propre.
    const jidResolu = await resoudreJidReel(target);
    const dest = jidResolu.includes('@') ? jidResolu : jidResolu + '@s.whatsapp.net';
    await sock.sendMessage(dest, { text });
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
  // CRITIQUE : fermer proprement l'ancien socket AVANT d'en recréer un
  // nouveau. Avant, connect() était rappelé directement par-dessus l'ancien
  // sock sans jamais le fermer : la connexion WebSocket Baileys sous-jacente
  // restait ouverte en arrière-plan avec ses propres timers/keepalive,
  // accumulant les handles à chaque micro-coupure réseau jusqu'à épuiser le
  // process (c'est un des suspects principaux du crash silencieux).
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

  // GARDE-FOU : sans ça, un appel réseau bloqué (typiquement
  // fetchLatestBaileysVersion(), qui n'a aucun timeout natif) fait rester
  // isConnecting=true POUR TOUJOURS — plus aucune reconnexion ne peut jamais
  // se déclencher, silence total, aucun log d'erreur (ce n'est pas un crash,
  // juste une promesse qui ne se résout jamais). Ce watchdog force un reset
  // après 45s et relance une tentative si connect() n'a toujours pas fini.
  const watchdog = setTimeout(() => {
    if (isConnecting) {
      console.error('[WHATSAPP] connect() bloqué depuis 45s (probablement fetchLatestBaileysVersion) — reset forcé.');
      isConnecting = false;
      reconnect();
    }
  }, 45000);

  try {
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
    clearTimeout(watchdog);
    isConnecting = false;
    return sock;
  } catch (err) {
    clearTimeout(watchdog);
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
    // AVANT : on détachait juste les listeners JS, mais la connexion
    // WebSocket sous-jacente de Baileys n'était jamais fermée — elle restait
    // ouverte en mémoire (socket TCP + timers keepalive internes) même après
    // qu'un nouveau sock ait été créé par-dessus. sock.end() la ferme pour
    // de vrai et laisse le garbage collector récupérer l'ancien objet.
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
