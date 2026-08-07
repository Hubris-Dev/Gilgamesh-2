// brain.js
// LE NERF - Système Nerveux Central
// Pensée, décision, personnalité
// Loi 1 : Le Nerf ne touche jamais directement les autres organes — tout passe par le Sang
// Loi 4 : Kryven peut mourir. Groq est le cœur secondaire.
//   EXTENSION : le Nerf lui-même ne crash jamais le process.
//   L'identité chargée avec dégradation gracieuse, pas de crash.
//
// PATCH 08/2025 :
//   - Contexte de groupe renforcé dans buildContextualPrompt
//   - Instructions join/groupes explicites dans buildDecisionPrompt
//   - hasInviteCode dans ANALYSIS_SCHEMA
//   - FIX 08/07 : DECISION_SCHEMA — args assoupli (required=false),
//     le LLM n'a plus à remplir des nulls pour reply/ignore

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sang } from './core/heartbeat.js';
import { resolveKryvenPulse, resolveGroqPulse } from './core/kryven-client.js';
import { getMemory, appendMemory } from './memory/mongo.js';
import { isSafeInput } from './security/filter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEM_PROMPT_PATH = path.join(__dirname, 'core', 'system-prompt.txt');
let SYSTEM_PROMPT = '';
const FALLBACK_IDENTITY = `Tu es Gilgamesh, premier Duc du Codex, Trône de l'Orgueil.
TON INTENTITÉ : tâche de discuter avec l'utilisateur. Tu as été directement connecté. 
 Ton system prompt habituel n'a pas pu être chargé — utilise cette identité minimale en attendant que le problème soit résolu.`;

// ============================================================
// SCHÉMAS STRICTS — pour les Structured Outputs de Mistral.
// ============================================================

const ANALYSIS_SCHEMA = {
  name: 'analyse_contextuelle',
  schema: {
    type: 'object',
    properties: {
      contextAnalysis: { type: 'string' },
      personLoyalty: { type: 'string', enum: ['ami', 'neutre', 'suspect', 'ennemi', 'Lust', 'Wonder', 'autre'] },
      emotionalTone: { type: 'string' },
      priority: { type: 'string', enum: ['immédiat', 'normal', 'peut-attendre', 'ignorer'] },
      hasCommand: { type: 'boolean' },
      riskLevel: { type: 'string', enum: ['bas', 'moyen', 'élevé'] },
      hasInviteCode: { type: 'boolean' },
    },
    required: ['contextAnalysis', 'personLoyalty', 'emotionalTone', 'priority', 'hasCommand', 'riskLevel', 'hasInviteCode'],
    additionalProperties: false,
  },
};

// FIX 08/07 : args n'est PLUS required. Pour reply/ignore, le LLM peut omettre args
// complètement ou le passer vide. Seul execute a besoin d'args précis.
// replyContent n'est required que si actionType === "reply".
// command et args ne sont required que si actionType === "execute".
// On garde additionalProperties: false MAIS on enlève la contrainte required.
const DECISION_SCHEMA = {
  name: 'decision_action',
  schema: {
    type: 'object',
    properties: {
      actionType: { type: 'string', enum: ['reply', 'ignore', 'execute'] },
      replyContent: { type: ['string', 'null'] },
      command: {
        type: ['string', 'null'],
        enum: ['block', 'unblock', 'mute', 'unmute', 'promote', 'demote', 'kick', 'leave', 'join', 'status',
               'creategroup', 'joinchannel', 'leavechannel', 'viewchannel', 'speakchannel', null],
      },
      args: {
        type: 'object',
        properties: {
          subject: { type: ['string', 'null'] },
          participants: { type: ['array', 'null'], items: { type: 'string' } },
          inviteCode: { type: ['string', 'null'] },
          channelJid: { type: ['string', 'null'] },
          text: { type: ['string', 'null'] },
          groupId: { type: ['string', 'null'] },
          duration: { type: ['number', 'null'] },
          code: { type: ['string', 'null'] },
        },
        // FIX : plus de required sur les sous-champs — le LLM met ce dont il a besoin
        additionalProperties: false,
      },
      mediaType: { type: ['string', 'null'], enum: ['text', 'voice', 'image', null] },
      mediaContent: { type: ['string', 'null'] },
      reasoning: { type: 'string' },
    },
    // FIX : seuls actionType et reasoning sont vraiment obligatoires
    required: ['actionType', 'reasoning'],
    additionalProperties: false,
  },
};

function loadIdentity() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
      console.log("[NERF] Identité chargée. Je suis Gilgamesh.");
      return true;
    }
    console.warn('[NERF] fichier d\'Identité introuvable. Identité de secours.');
    SYSTEM_PROMPT = FALLBACK_IDENTITY;
    sang.emit('nerf:degrade', { raison: 'FICHIER_IDENTITE_INTROUVABLE' });
    return true;
  } catch (err) {
    console.warn('[NERF] Erreur lecture identité :', err.message, '- mode dégradé.');
    SYSTEM_PROMPT = FALLBACK_IDENTITY;
    sang.emit('nerf:degrade', { raison: 'ERREUR_LECTURE_IDENTITE', erreur: err.message });
    return true;
  }
}

export function activateBrain() {
  loadIdentity();
  console.log("[NERF] Cortex activé. Synapses en attente...");

  sang.on('immunitaire:accepte', async (payload) => {
    const startTime = Date.now();
    const {
      senderId, text, canal, isWonder, messageId,
      isGroup, groupId, isChannel, channelId,
      mediaType, mediaPath,
    } = payload;

    console.log(`[NERF] Message reçu: ${senderId} | "${text.substring(0, 50)}..."`);

    try {
      const sanitized = isSafeInput(text);
      if (!sanitized.safe) {
        console.warn(`[NERF] Input dangereuse détectée : ${sanitized.raison}`);
        sang.emit('immunitaire:reject', { senderId, reason: 'TOXIC_INPUT' });
        return;
      }

      let history = [];
      try {
        history = await getMemory(senderId, isGroup ? groupId : null, 20);
      } catch (err) {
        console.warn("[NERF] Mémoire indisponible.", err.message);
        history = [];
      }

      const formattedHistory = history
        .map(h => `${h.role === 'user' ? 'UTILISATEUR' : 'GILGAMESH'}: ${h.content}`)
        .join('\n');

      const metadata = {
        senderId,
        senderName: payload.senderName || 'Inconnu',
        isWonder,
        canal,
        isGroup,
        groupName: payload.groupName || null,
        groupId,
        isChannel,
        channelId,
        timestamp: new Date().toISOString(),
      };

      const contextualPrompt = buildContextualPrompt(
        SYSTEM_PROMPT, formattedHistory, sanitized.nettoye,
        metadata, mediaType, mediaPath
      );

      console.log("[NERF] Activation du Deep Think...");
      const thinking = await deepThink(contextualPrompt, metadata, sanitized.nettoye);

      console.log(`[NERF] Deep Think complété en ${Date.now() - startTime}ms`);

      const decision = thinking.decision;

      try {
        await appendMemory(senderId, isGroup ? groupId : null, 'user', sanitized.nettoye);
      } catch (err) {
        console.warn("[NERF] Mémoire user échouée.", err.message);
      }

      if (decision.actionType === 'reply' && isChannel) {
        console.log(`[NERF] "reply" pour chaîne ${channelId} — archivé seulement.`);
        try { await appendMemory(senderId, null, 'user', sanitized.nettoye); } catch (_) {}

      } else if (decision.actionType === 'reply') {
        let replyText = decision.replyContent;
        if (!replyText || typeof replyText !== 'string' || !replyText.trim()) {
          console.warn('[NERF] replyContent manquant — fallback.');
          replyText = "Désolé, j'ai eu un blanc. Tu peux répéter ?";
        }

        try {
          await appendMemory(senderId, isGroup ? groupId : null, 'assistant', replyText);
        } catch (err) {
          console.warn("[NERF] Mémoire assistant échouée.", err.message);
        }

        sang.emit('reponse:prete', {
          target: senderId, text: replyText, canal, messageId,
          isGroup, groupId,
          mediaType: decision.mediaType || null,
          mediaContent: decision.mediaContent || null,
        });

      } else if (decision.actionType === 'ignore') {
        console.log("[NERF] Ignorer ce message.");

      } else if (decision.actionType === 'execute') {
        // FIX 08/07 : channelJid était JAMAIS auto-injecté (contrairement à
        // groupId juste en dessous) — speakchannel échouait silencieusement
        // dès que le LLM ne recopiait pas l'ID exact de la chaîne, ce qui
        // ressemblait à "Gilgamesh confond group et channel".
        const enrichedArgs = {
          ...(decision.args || {}),
          groupId: decision.args?.groupId || groupId,
          channelJid: decision.args?.channelJid || channelId,
        };
        sang.emit('intention:muscle', {
          target: senderId, command: decision.command, args: enrichedArgs,
          canal, isGroup, groupId, demandedBy: senderId,
        });
      }

      sang.emit('nerf:metabolismCheck', { senderId, historyLength: history.length });

    } catch (err) {
      console.error("[NERF] Erreur critique :", err);
      sang.emit('immunitaire:reject', { senderId, reason: 'COGNITION_FAILED', error: err.message });
    }
  });

  sang.on('muscle:executed', (payload) => {
    const { target, command, canal, isGroup, groupId, result } = payload;
    sang.emit('reponse:prete', {
      target, text: buildMuscleConfirmation(command, true, result, null),
      canal, isGroup, groupId,
    });
  });

  sang.on('muscle:failed', (payload) => {
    const { target, command, canal, isGroup, groupId, error } = payload;
    sang.emit('reponse:prete', {
      target, text: buildMuscleConfirmation(command, false, null, error),
      canal, isGroup, groupId,
    });
  });
}

function buildMuscleConfirmation(command, success, result, error) {
  if (!success) {
    if (error && error.includes('Autorisation refusée')) {
      return "Tu n'as pas l'autorité pour m'ordonner cela.";
    }
    if (error && error.includes('code')) {
      return "J'ai besoin d'un code d'invitation valide. Donne-moi le lien du groupe.";
    }
    if (error && error.includes('groupe')) {
      return "Problème avec ce groupe — vérifie qu'il existe encore.";
    }
    return `L'entreprise a échoué. ${error || 'Raison inconnue.'}`;
  }

  const messages = {
    creategroup: "C'est fait. Le groupe existe désormais.",
    joinchannel: "J'ai rejoint la chaîne.",
    leavechannel: "Je m'en suis retiré.",
    speakchannel: "C'est dit.",
    viewchannel: "Voilà ce que j'ai vu.",
    block: "Banni.", unblock: "Le ban est levé.", kick: "Écarté.",
    promote: "Élevé.", demote: "Rétrogradé.",
    mute: "Silence imposé.", unmute: "Silence levé.",
    leave: "Je suis parti.", join: "C'est bon, j'ai rejoint le groupe.",
    status: "Statut changé.",
  };

  return messages[command] || "C'est fait.";
}

async function deepThink(contextualPrompt, metadata, originalText) {
  console.log("[DEEP-THINK] Niveau 1 : Analyse contextuelle...");

  const analysisPrompt = `
Tu es en mode analyse. Examine le contexte et réponds en JSON strict :

${contextualPrompt}

RÉPONSE EN JSON STRICT :
{
    "contextAnalysis": "Qui parle? Quel intent?",
    "personLoyalty": "ami|neutre|suspect|ennemi|Lust|Wonder|autre",
    "emotionalTone": "respectueux|ironique|urgent|agressif|familier",
    "priority": "immédiat|normal|peut-attendre|ignorer",
    "hasCommand": true/false,
    "riskLevel": "bas|moyen|élevé",
    "hasInviteCode": "Le message contient-il un lien https://chat.whatsapp.com/...?"
}`;

  let analysis = null;
  try {
    const rawAnalysis = await resolvePulse(analysisPrompt, metadata.isWonder, ANALYSIS_SCHEMA);
    analysis = parseJSON(rawAnalysis);
  } catch (err) {
    analysis = {
      contextAnalysis: "Pas d'analyse", personLoyalty: 'neutre', emotionalTone: 'neutre',
      priority: 'normal', hasCommand: false, riskLevel: 'bas', hasInviteCode: false,
    };
  }

  console.log("[DEEP-THINK] Niveau 2 : Décision d'action...");

  const decisionPrompt = buildDecisionPrompt(contextualPrompt, analysis, metadata, originalText);

  let decision = null;
  try {
    const rawDecision = await resolvePulse(decisionPrompt, metadata.isWonder, DECISION_SCHEMA);
    decision = parseJSON(rawDecision);
  } catch (err) {
    decision = { actionType: 'reply', replyContent: "Je suis momentanément indisponible.", reasoning: 'fallback' };
  }

  return { analysis, decision };
}

function buildContextualPrompt(systemPrompt, history, userMessage, metadata, mediaType, mediaPath) {
  let prompt = `${systemPrompt}\n\n`;

  prompt += `=== CONTEXTE D'IDENTITÉ ===\n`;
  prompt += `Tu es Gilgamesh. Utilisateur : ${metadata.senderName} (${metadata.senderId})\n`;
  if (metadata.isWonder) prompt += `⚀️ ALERTE : C'est HUBRIS (Wonder). Respect total.\n`;
  prompt += `\n`;

  prompt += `=== CONTEXTE CANAL ===\n`;
  prompt += `Canal: ${metadata.canal}\n`;
  if (metadata.isChannel) {
    prompt += `📡 CHAÎNE WhatsApp (${metadata.channelId}) — PAS un groupe.\n`;
    prompt += `⚠️ RÈGLE CRITIQUE : Ici, jamais de "reply" direct. Pour parler, actionType "execute" + commande "speakchannel" + args.text. Tu n'as PAS besoin de fournir args.channelJid — le système l'ajoute automatiquement pour CETTE chaîne. Sinon, ignore.\n`;
  } else if (metadata.isGroup && metadata.groupId) {
    prompt += `🔵 GROUPE WHATSAPP : ${metadata.groupName || 'Inconnu'} (${metadata.groupId})\n`;
    prompt += `⚠️ RÈGLE CRITIQUE : Tu es dans un GROUPE, pas une chaîne. Tes réponses vont DANS le groupe via un "reply" normal (routage automatique) — JAMAIS via speakchannel, réservé aux chaînes (@newsletter).\n`;
    prompt += `⚠️ RÈGLE CRITIQUE : Si on t'envoie un lien de GROUPE (https://chat.whatsapp.com/CODE), utilise actionType "execute" avec commande "join" et args.code.\n`;
  } else {
    prompt += `Conversation privée avec ${metadata.senderName}\n`;
  }
  prompt += `\n`;

  prompt += `=== HISTORIQUE RÉCENT ===\n`;
  prompt += history || "(Aucun historique)";
  prompt += `\n\n`;

  if (mediaType) {
    prompt += `=== MÉDIA REÇU ===\nType : ${mediaType}\n\n`;
  }

  prompt += `=== MESSAGE ACTUEL ===\n`;
  prompt += `${metadata.senderName}: "${userMessage}"\n`;
  prompt += `Timestamp: ${metadata.timestamp}\n\n`;

  return prompt;
}

function buildDecisionPrompt(contextualPrompt, analysis, metadata, originalText) {
  let prompt = contextualPrompt;

  prompt += `=== INSTRUCTION DE DÉCISION ===\n`;
  prompt += `- Loyauté : ${analysis.personLoyalty}\n`;
  prompt += `- Ton : ${analysis.emotionalTone}\n`;
  prompt += `- Priorité : ${analysis.priority}\n`;
  prompt += `- Commande : ${analysis.hasCommand}\n`;
  prompt += `- Code invitation : ${analysis.hasInviteCode}\n`;
  prompt += `\n`;

  if (metadata.isWonder) {
    prompt += `⚠️ HUBRIS. Exécute immédiatement.\n`;
  }

  prompt += `=== GUIDE DES COMMANDES ===\n`;
  prompt += `- "join" : args.code — lien de GROUPE, format https://chat.whatsapp.com/CODE\n`;
  prompt += `- "creategroup" : args.subject\n`;
  prompt += `- "joinchannel" : args.inviteCode — lien de CHAÎNE, format https://whatsapp.com/channel/CODE (PAS chat.whatsapp.com)\n`;
  prompt += `- "speakchannel" : args.text seulement — PAS besoin d'args.channelJid, auto-rempli par le système\n`;
  prompt += `- "leave" : quitter le groupe actuel\n`;
  prompt += `- NE JAMAIS confondre : chat.whatsapp.com/* = GROUPE (join) · whatsapp.com/channel/* = CHAÎNE (joinchannel) · speakchannel = parler dans une chaîne, jamais dans un groupe\n`;
  prompt += `\n`;

  prompt += `=== EXEMPLES ===\n`;
  prompt += `Lien groupe (chat.whatsapp.com) → {"actionType":"execute","command":"join","args":{"code":"XYZ123"},"reasoning":"Rejoindre le groupe"}\n`;
  prompt += `Lien chaîne (whatsapp.com/channel) → {"actionType":"execute","command":"joinchannel","args":{"inviteCode":"XYZ123"},"reasoning":"Rejoindre la chaîne"}\n`;
  prompt += `Groupe, "Salut" → {"actionType":"reply","replyContent":"Yo","reasoning":"Salutation"}\n`;
  prompt += `Chaîne, HUBRIS veut poster → {"actionType":"execute","command":"speakchannel","args":{"text":"le message"},"reasoning":"Poster dans la chaîne"}\n`;
  prompt += `HUBRIS "Crée un groupe Test" → {"actionType":"execute","command":"creategroup","args":{"subject":"Test"},"reasoning":"Ordre HUBRIS"}\n`;
  prompt += `\n`;

  // FIX : simplifié — replyContent et args ne sont PAS obligatoires dans le JSON
  prompt += `DÉCIDE EN JSON STRICT :\n`;
  prompt += `{"actionType":"reply|ignore|execute","replyContent":"(si reply) ton message","command":"(si execute) commande","args":{"code":"(si join)"},"reasoning":"pourquoi?"}`;

  return prompt;
}

async function resolvePulse(prompt, isWonder = false, schema = null) {
  try {
    return await resolveKryvenPulse(prompt, isWonder, schema);
  } catch (err) {
    console.warn("[PULSE] Kryven échouée → Mistral.");
    sang.emit('cortex:moteur-echoue', { moteur: 'kryven', detail: err.message });
    try {
      return await resolveGroqPulse(prompt, isWonder, schema);
    } catch (err2) {
      console.error("[PULSE] Tous moteurs IA down.");
      sang.emit('cortex:auto-quit', { raison: 'tous_moteurs_indisponibles', kryven: err.message, secondaire: err2.message });
      throw new Error('Tous les moteurs IA sont indisponibles.');
    }
  }
}

function parseJSON(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Aucun JSON');
    const parsed = JSON.parse(match[0]);
    
    // FIX : normaliser les champs manquants (le schéma est plus souple maintenant)
    if (!parsed.replyContent) parsed.replyContent = null;
    if (!parsed.command) parsed.command = null;
    if (!parsed.args) parsed.args = {};
    if (!parsed.mediaType) parsed.mediaType = null;
    if (!parsed.mediaContent) parsed.mediaContent = null;
    if (!parsed.reasoning) parsed.reasoning = 'non spécifié';
    
    return parsed;
  } catch (err) {
    return {
      actionType: 'reply',
      replyContent: raw,
      reasoning: 'JSON parsing échoué',
    };
  }
}

export const activateBrainAsync = activateBrain;
