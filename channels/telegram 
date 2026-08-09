// channels/telegram.js
// LE POUMON TELEGRAM — Canal de Communication
// RÔLE : équivalent architectural de channels/whatsapp.js pour Telegram.
// Long-polling (getUpdates) — pas de webhook, pas de dépendance en plus (axios déjà présent).
//
// LIMITES RÉELLES DE L'API BOT TELEGRAM (vérifiées, pas de mécanique inventée) :
//   - Un bot NE PEUT PAS créer de groupe (aucune méthode Bot API pour ça).
//   - Un bot NE PEUT PAS rejoindre un groupe/chaîne via lien d'invitation —
//     il doit y être AJOUTÉ par un humain. "join"/"joinchannel"/"creategroup"
//     n'ont donc pas d'équivalent ici (voir muscle.js — erreurs explicites).
//   - Un bot NE PEUT PAS initier une conversation privée avec quelqu'un qui
//     ne lui a jamais écrit (contrainte Telegram, pas un bug).
//   - Pas de "block" côté API Bot — géré en base via security/blocklist.js.
//
// PRÉREQUIS DE CONFIGURATION (@BotFather) :
//   - /setprivacy → Disable — SINON le bot ne voit que les mentions/commandes
//     dans les groupes, pas les messages normaux. Volonté a besoin de tout voir.
//   - /setjoingroups → Enable — pour pouvoir être ajouté à des groupes.

import axios from 'axios';
import { sang } from '../core/heartbeat.js';

const NOM_CANAL = 'telegram';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const POLL_TIMEOUT_S = 30;
const MAX_ECHECS_CONSECUTIFS = 10;

let offset = 0;
let arrete = true;
let botInfo = null;
let echecsConsecutifs = 0;

/**
 * TELEGRAMAPI — Wrapper unique pour tous les appels Bot API.
 * Exporté pour que muscle.js puisse appeler n'importe quelle méthode
 * (banChatMember, promoteChatMember, etc.) sans dupliquer la logique axios.
 */
export async function telegramApi(method, params = {}) {
  if (!API_BASE) throw new Error('TELEGRAM_BOT_TOKEN manquant — canal Telegram non configuré.');
  try {
    const { data } = await axios.post(`${API_BASE}/${method}`, params, {
      timeout: (POLL_TIMEOUT_S + 15) * 1000,
    });
    if (!data.ok) throw new Error(data.description || `Échec ${method}`);
    return data.result;
  } catch (err) {
    const desc = err.response?.data?.description || err.message;
    throw new Error(`Telegram ${method} : ${desc}`);
  }
}

function extraireTexte(message) {
  return message.text || message.caption || '';
}

function parseUpdate(update) {
  const message = update.message || update.channel_post;
  if (!message) return null;

  const chat = message.chat;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  const isChannel = chat.type === 'channel';
  // channel_post n'a pas de .from (le post vient du canal lui-même, pas d'un utilisateur précis)
  const senderId = message.from ? String(message.from.id) : String(chat.id);
  const replyToUserId = message.reply_to_message?.from ? String(message.reply_to_message.from.id) : null;

  return {
    sender: senderId,
    messageId: String(message.message_id),
    text: extraireTexte(message),
    timestamp: message.date,
    isGroup,
    isChannel,
    nomAffiche: message.from?.first_name || message.from?.username || chat.title || 'Inconnu',
    chatId: String(chat.id),
    chatTitle: chat.title || null,
    replyToUserId,
  };
}

function handleUpdate(update) {
  const propre = parseUpdate(update);
  if (!propre || !propre.text) return;

  console.log(`[TELEGRAM] Message de ${propre.nomAffiche} (${propre.sender}) — groupe=${propre.isGroup} chaîne=${propre.isChannel}`);

  sang.emit('canal:message:recu', {
    senderId: propre.sender,
    text: propre.text,
    canal: NOM_CANAL,
    messageId: propre.messageId,
    senderName: propre.nomAffiche,
    isGroup: propre.isGroup,
    groupId: propre.isGroup ? propre.chatId : null,
    groupName: propre.isGroup ? propre.chatTitle : null,
    isChannel: propre.isChannel,
    channelId: propre.isChannel ? propre.chatId : null,
    replyToUserId: propre.replyToUserId,
    mediaType: null,
    mediaPath: null,
  });
}

/**
 * POLL — Boucle de long-polling. Ne meurt JAMAIS le process (Loi 4) :
 * une erreur réseau/API retry avec backoff, point final. Telegram n'a pas
 * l'équivalent d'une "session révoquée" WhatsApp — pas de raison structurelle
 * de tuer le process ici.
 */
async function poll() {
  if (arrete) return;
  try {
    const updates = await telegramApi('getUpdates', {
      offset,
      timeout: POLL_TIMEOUT_S,
      allowed_updates: ['message', 'channel_post'],
    });

    echecsConsecutifs = 0;

    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        handleUpdate(update);
      } catch (err) {
        console.error('[TELEGRAM] Erreur traitement update:', err.message);
        sang.emit('telegram:erreur', { niveau: 'error', raison: 'traitement_update', detail: err.message });
      }
    }

    if (!arrete) setImmediate(poll);
  } catch (err) {
    echecsConsecutifs += 1;
    console.error(`[TELEGRAM] Erreur polling (${echecsConsecutifs}/${MAX_ECHECS_CONSECUTIFS}):`, err.message);
    sang.emit('telegram:erreur', { niveau: 'warn', raison: 'polling_echoue', detail: err.message, tentative: echecsConsecutifs });

    if (echecsConsecutifs === 1) {
      sang.emit('canal:deconnecte', { canal: NOM_CANAL, raison: err.message });
    }

    // Backoff exponentiel plafonné à 60s — jamais de process.exit ici.
    const delai = Math.min(5000 * echecsConsecutifs, 60000);
    if (!arrete) setTimeout(poll, delai);
  }
}

/**
 * HANDLEREPONSEPRETE — filtre sur canal='telegram' pour ne jamais
 * intercepter les réponses destinées à WhatsApp (et vice-versa).
 */
async function handleReponsePrete(payload) {
  if (payload.canal && payload.canal !== NOM_CANAL) return;
  try {
    const { target, text, isGroup, groupId } = payload;
    if (!API_BASE || !target || !text) return;

    const dest = (isGroup && groupId) ? groupId : target;
    console.log(`[TELEGRAM] Envoi → ${dest}`);
    await telegramApi('sendMessage', { chat_id: dest, text });
    console.log(`[TELEGRAM] ✓ Message envoyé → ${dest}`);
  } catch (err) {
    console.error(`[TELEGRAM] Échec envoi : ${err.message}`);
    sang.emit('telegram:erreur', { niveau: 'warn', raison: 'envoi_echoue', detail: err.message });
  }
}

/**
 * CONNECT — Point d'entrée. Retourne null (jamais d'exception qui remonte,
 * jamais de process.exit) si TELEGRAM_BOT_TOKEN est absent : le canal est
 * OPTIONNEL, WhatsApp doit continuer à fonctionner sans lui.
 */
async function connect() {
  if (!BOT_TOKEN) {
    console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN absent — canal désactivé (les autres canaux continuent).');
    return null;
  }

  try {
    botInfo = await telegramApi('getMe');
    console.log(`[TELEGRAM] Connecté : @${botInfo.username} (id ${botInfo.id})`);
  } catch (err) {
    console.error('[TELEGRAM] Échec getMe — token invalide ?', err.message);
    sang.emit('telegram:erreur', { niveau: 'error', raison: 'token_invalide', detail: err.message });
    return null;
  }

  sang.off('reponse:prete', handleReponsePrete);
  sang.on('reponse:prete', handleReponsePrete);

  arrete = false;
  echecsConsecutifs = 0;
  sang.emit('canal:connecte', { canal: NOM_CANAL });
  poll();
  return botInfo;
}

function cleanup() {
  arrete = true;
  sang.off('reponse:prete', handleReponsePrete);
}

function isAlive() {
  return !arrete && !!botInfo;
}

function getBotInfo() {
  return botInfo;
}

async function envoyer(destinataire, texte) {
  if (!API_BASE) return false;
  try {
    await telegramApi('sendMessage', { chat_id: destinataire, text: texte });
    return true;
  } catch (err) {
    return false;
  }
}

export { connect, cleanup, isAlive, getBotInfo, envoyer, NOM_CANAL };
