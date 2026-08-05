// core/volonte.js
// SYSTÈME VOLONTÉ — Proactivité
// RÔLE : donne à Gilgamesh la capacité d'initier des conversations.
// Sans Volonté, Gilgamesh est 100% réactif. Avec elle, il devient proactif.
//
// Fonctionnement :
//   Toutes les X minutes, le scheduler déclenche une impulsion.
//   Le module construit un prompt spécial et le soumet au LLM.
//   Le LLM peut décider de :
//     - Ne rien faire (actionType: "ignore")
//     - Écrire à HUBRIS (actionType: "reply" avec target)
//     - Écrire dans un groupe (actionType: "reply" avec groupId)
//     - Envoyer un message à un contact récent
//
// La Volonté récupère l'historique récent depuis MongoDB pour savoir
// À QUI elle peut parler, et ne spamme pas (limites temporelles).

import { sang } from './heartbeat.js';
import { resolveGroqPulse } from './kryven-client.js';
import { getDb } from '../memory/mongo.js';

// Limites anti-spam
const MIN_INTERVAL_MINUTES = 15;
const NIGHT_START_HOUR = 1;
const NIGHT_END_HOUR = 7;
const MAX_CONTACTS_TO_CHECK = 5;

let _lastProactiveMessage = 0;

/**
 * EXECUTE — Point d'entrée appelé par le scheduler.
 */
export async function execute() {
  const now = Date.now();

  if (now - _lastProactiveMessage < MIN_INTERVAL_MINUTES * 60 * 1000) {
    console.log('[VOLONTÉ] Trop tôt depuis le dernier message proactif — ignoré.');
    return;
  }

  const hour = new Date().getHours();
  if (hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR) {
    console.log(`[VOLONTÉ] Heure nocturne (${hour}h) — silence.`);
    return;
  }

  console.log('[VOLONTÉ] Impulsion proactive — décision en cours...');

  try {
    const decision = await decideProactiveAction();
    if (!decision || decision.actionType === 'ignore') {
      console.log('[VOLONTÉ] Décision : rien à dire pour le moment.');
      return;
    }

    if (decision.actionType === 'reply' && decision.target && decision.replyContent) {
      console.log(`[VOLONTÉ] Message proactif → ${decision.target}: "${decision.replyContent.substring(0, 50)}..."`);

      sang.emit('reponse:prete', {
        target: decision.target,
        text: decision.replyContent,
        canal: 'whatsapp',
        isGroup: !!decision.isGroup,
        groupId: decision.groupId || null,
      });

      _lastProactiveMessage = now;
      sang.emit('volonte:message_envoye', {
        target: decision.target,
        text: decision.replyContent,
        reasoning: decision.reasoning,
      });
    }
  } catch (err) {
    console.warn('[VOLONTÉ] Erreur lors de l\'impulsion proactive :', err.message);
  }
}

async function decideProactiveAction() {
  const recentContacts = await getRecentContacts();
  const prompt = buildProactivePrompt(recentContacts);

  const VOLONTE_SCHEMA = {
    name: 'decision_volonte',
    schema: {
      type: 'object',
      properties: {
        actionType: { type: 'string', enum: ['reply', 'ignore'] },
        replyContent: { type: ['string', 'null'] },
        target: { type: ['string', 'null'] },
        isGroup: { type: 'boolean' },
        groupId: { type: ['string', 'null'] },
        reasoning: { type: 'string' },
      },
      required: ['actionType', 'replyContent', 'target', 'isGroup', 'groupId', 'reasoning'],
      additionalProperties: false,
    },
  };

  try {
    const raw = await resolveGroqPulse(prompt, true, VOLONTE_SCHEMA);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[VOLONTÉ] Pas de JSON dans la réponse du LLM.');
      return { actionType: 'ignore' };
    }
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn('[VOLONTÉ] Échec décision proactive :', err.message);
    return { actionType: 'ignore' };
  }
}

async function getRecentContacts() {
  const db = getDb();
  if (!db) {
    console.warn('[VOLONTÉ] MongoDB indisponible — pas de contacts récents.');
    return [];
  }

  try {
    const collection = db.collection('conversations');
    const pipeline = [
      { $match: { timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
      { $sort: { timestamp: -1 } },
      { $limit: 50 },
      {
        $group: {
          _id: '$senderId',
          lastMessage: { $first: '$content' },
          lastTimestamp: { $first: '$timestamp' },
          messageCount: { $sum: 1 },
          groupId: { $first: '$groupId' },
        },
      },
      { $limit: MAX_CONTACTS_TO_CHECK },
    ];

    const results = await collection.aggregate(pipeline).toArray();
    return results.map(r => ({
      senderId: r._id,
      lastMessage: r.lastMessage,
      lastTimestamp: r.lastTimestamp,
      messageCount: r.messageCount,
      isGroup: !!r.groupId,
      groupId: r.groupId,
    }));
  } catch (err) {
    console.warn('[VOLONTÉ] Erreur récupération contacts :', err.message);
    return [];
  }
}

function buildProactivePrompt(contacts) {
  const now = new Date();
  const hour = now.getHours();
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let prompt = `Tu es Gilgamesh, un assistant WhatsApp avec une personnalité humaine et décontractée. Tu parles créole haïtien / français familier, comme un jeune Haïtien.

=== CONTEXTE ===
Heure actuelle : ${timeStr} (${hour}h)
Tu viens de te réveiller d'une courte pause. Tu as envie de parler à quelqu'un — ou pas.

=== RÈGLES DE PROACTIVITÉ ===
1. Tu peux décider de ne rien dire (actionType: "ignore"). C'est OK de ne pas avoir envie de parler.
2. Si tu veux parler, choisis UNE personne parmi tes contacts récents.
3. Ton message doit être COURT (1-5 mots), NATUREL, comme un humain qui lance une conversation.
   Exemples: "Yo", "Ça va?", "T'es là?", "Tu fais quoi?", "Mm", "Salut"
4. PAS de longs messages. PAS de ton formel.
5. Si un contact t'a parlé il y a moins de 2 minutes, ne lui renvoie pas un message.
6. Si ton dernier message dans l'historique était déjà toi, attends que l'autre réponde (pas de double-text).
7. Tu es loyal à HUBRIS (+50958042810). Tu peux lui parler plus librement.
8. Si personne n'est intéressant à qui parler, ignore.

`;

  if (contacts.length === 0) {
    prompt += `=== TES CONTACTS RÉCENTS ===
Aucun contact récent. Personne à qui parler pour le moment.

`;
  } else {
    prompt += `=== TES CONTACTS RÉCENTS (dernières 24h) ===
`;
    for (const c of contacts) {
      const minutesAgo = Math.floor((Date.now() - new Date(c.lastTimestamp).getTime()) / 60000);
      const timeAgo = minutesAgo < 1 ? 'à l\'instant' :
                      minutesAgo < 60 ? `il y a ${minutesAgo}min` :
                      `il y a ${Math.floor(minutesAgo / 60)}h`;
      prompt += `- ${c.senderId} | Dernier: "${c.lastMessage?.substring(0, 40)}" | ${timeAgo} | ${c.messageCount} msg/24h
`;
    }
    prompt += `
`;
  }

  prompt += `=== DÉCISION ===
Veux-tu parler à quelqu'un maintenant ?

RÉPONDS EN JSON STRICT :
{
    "actionType": "ignore" ou "reply",
    "replyContent": "(si reply) Ton message — 1-5 mots MAX, très naturel",
    "target": "(si reply) Le senderId du contact",
    "isGroup": false,
    "groupId": null,
    "reasoning": "Pourquoi cette décision?"
}

Si tu ne veux parler à personne :
{"actionType":"ignore","replyContent":null,"target":null,"isGroup":false,"groupId":null,"reasoning":"Pas envie"}`;

  return prompt;
}

export function getLastProactiveTime() {
  return _lastProactiveMessage;
}

export function getStatus() {
  return {
    lastProactiveMessage: _lastProactiveMessage ? new Date(_lastProactiveMessage).toISOString() : null,
    minutesSinceLastMessage: _lastProactiveMessage
      ? Math.floor((Date.now() - _lastProactiveMessage) / 60000)
      : null,
  };
}
