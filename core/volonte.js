// core/volonte.js
// SYSTÈME VOLONTÉ — Proactivité
// RÔLE : donne à Gilgamesh la capacité d'initier des conversations.
// FIX 08/07 : recréé (fichier manquait du repo)

import { sang } from './heartbeat.js';
import { resolveGroqPulse } from './kryven-client.js';
import { getDb } from '../memory/mongo.js';

const MIN_INTERVAL_MINUTES = 15;
const NIGHT_START_HOUR = 1;
const NIGHT_END_HOUR = 7;
const MAX_CONTACTS_TO_CHECK = 5;

let _lastProactiveMessage = 0;

export async function execute() {
  const now = Date.now();

  if (now - _lastProactiveMessage < MIN_INTERVAL_MINUTES * 60 * 1000) {
    return;
  }

  const hour = new Date().getHours();
  if (hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR) {
    return;
  }

  console.log('[VOLONTÉ] Impulsion proactive...');

  try {
    const decision = await decideProactiveAction();
    if (!decision || decision.actionType === 'ignore') {
      return;
    }

    if (decision.actionType === 'reply' && decision.target && decision.replyContent) {
      console.log(`[VOLONTÉ] → ${decision.target}: "${decision.replyContent.substring(0, 50)}"`);
      sang.emit('reponse:prete', {
        target: decision.target,
        text: decision.replyContent,
        canal: 'whatsapp',
        isGroup: !!decision.isGroup,
        groupId: decision.groupId || null,
      });
      _lastProactiveMessage = now;
    }
  } catch (err) {
    console.warn('[VOLONTÉ] Erreur:', err.message);
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
    return match ? JSON.parse(match[0]) : { actionType: 'ignore' };
  } catch (err) {
    return { actionType: 'ignore' };
  }
}

async function getRecentContacts() {
  const db = getDb();
  if (!db) return [];

  try {
    const collection = db.collection('conversations');
    const results = await collection.aggregate([
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
    ]).toArray();

    return results.map(r => ({
      senderId: r._id,
      lastMessage: r.lastMessage,
      lastTimestamp: r.lastTimestamp,
      messageCount: r.messageCount,
      isGroup: !!r.groupId,
      groupId: r.groupId,
    }));
  } catch (err) {
    return [];
  }
}

function buildProactivePrompt(contacts) {
  const now = new Date();
  const hour = now.getHours();
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let prompt = `Tu es Gilgamesh, un assistant WhatsApp avec une personnalité humaine. Créole haïtien / français familier.

=== CONTEXTE ===
Heure : ${timeStr} (${hour}h). Tu viens de te réveiller d'une pause.

=== RÈGLES ===
1. Tu peux ne rien dire (ignore).
2. Si tu veux parler, choisis UN contact.
3. Message COURT (1-5 mots): "Yo", "Ça va?", "Salut", etc.
4. Pas de double-text.
5. Loyal à HUBRIS (+50958042810).

`;

  if (contacts.length === 0) {
    prompt += `Aucun contact récent.\n`;
  } else {
    for (const c of contacts) {
      const mins = Math.floor((Date.now() - new Date(c.lastTimestamp).getTime()) / 60000);
      const ago = mins < 1 ? 'maintenant' : mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h`;
      prompt += `- ${c.senderId} | "${c.lastMessage?.substring(0, 30)}" | ${ago}\n`;
    }
  }

  prompt += `\nDÉCIDE JSON: {"actionType":"ignore|reply","replyContent":"...","target":"...","isGroup":false,"groupId":null,"reasoning":"..."}`;
  return prompt;
}

export function getLastProactiveTime() { return _lastProactiveMessage; }

export function getStatus() {
  return {
    lastProactiveMessage: _lastProactiveMessage ? new Date(_lastProactiveMessage).toISOString() : null,
    minutesSinceLastMessage: _lastProactiveMessage ? Math.floor((Date.now() - _lastProactiveMessage) / 60000) : null,
  };
}
