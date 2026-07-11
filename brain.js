// brain.js
// LE NERF - Système Nerveux Central
// Pensée, décision, personnalité
// Loi 1 : Le Nerf ne touche jamais directement les autres organes — tout passe par le Sang
// Loi 4 : Kryven peut mourir. Groq est le cœur secondaire.
//   EXTENSION : le Nerf lui-même ne crash jamais le process.
//   L'identité chargée avec dégradation gracieuse, pas de crash.

const fs = require('fs');
const path = require('path');
const { sang } = require('./core/heartbeat');
const { resolveKryvenPulse, resolveGroqPulse } = require('./core/kryven-client');
const { getMemory, appendMemory } = require('./memory/mongo');
const { isSafeInput } = require('./security/filter');

// Charger l'identité — l'ADN du Nerf (Système Endocrinien)
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'core', 'system-prompt.txt');
let SYSTEM_PROMPT: string = '';
// Identité de secours en cas de fichier system-prompt.txt manquant.
// Loi 4 : les pannes externes ne tuent pas Gilgamesh.
const FALLBACK_IDENTITY = `Tu es Gilgamesh, premier Duc du Codex, Trône de l'Orgueil.
TON INTENTITÉ : tâche de discuter avec l'utilisateur. Tu as été directement connecté. 
 Ton system prompt habituel n'a pas pu être chargé — utilise cette identité minimale en attendant que le problème soit résolu.`;

function loadIdentity() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
      console.log("[NERF] Identité chargée. Je suis Gilgamesh.");
      return true;
    }
    console.warn('[NERF] fichier d\'Identité (' + SYSTEM_PROMPT_PATH + ') introuvable. Identité de secours.');
    SYSTEM_PROMPT = FALLBACK_IDENTITY;
    sang.emit('nerf:degrade', { raison: 'FICHIER_IDENTITE_INTROUVABLE' });
    return true; // Survis en mode dégradé
  } catch (err) {
    console.warn('[NERF] Erreur lecture identité :', err.message, '- mode dégradé.');
    SYSTEM_PROMPT = FALLBACK_IDENTITY;
    sang.emit('nerf:degrade', { raison: 'ERREUR_LECTURE_IDENTITE', erreur: err.message });
    return true;
  }
}

/**
 * ACTIVATEBRAIN — Point d'entrée du Système Nerveux
 * Écoute les signaux du Sang (message accepté par l'Immunitaire)
 * Applique la pensée (Deep Think), puis émet une intention
 */
function activateBrain() {
  loadIdentity();
  console.log("[NERF] Cortex activé. Synapses en attente...");

  // Le Nerf reçoit chaque message validé par l'Immunitaire (Porte de Babylone)
  sang.on('immunitaire:accepte', async (payload) => {
    const startTime = Date.now();
    const {
      senderId,
      text,
      canal,
      isWonder,
      messageId,
      isGroup,
      groupId,
      mediaType,
      mediaPath,
    } = payload;

    console.log(`[NERF] Message reçu: ${senderId} | "${text.substring(0, 50)}..."`);

    try {
      // ============================================================
      // ÉTAPE 1 : NETTOYAGE (Foie logique du Nerf)
      // ============================================================
      const sanitized = isSafeInput(text);
      if (!sanitized.safe) {
        console.warn(`[NERF] Input dangereuse détectée : ${sanitized.raison}`);
        sang.emit('immunitaire:reject', { senderId, reason: 'TOXIC_INPUT' });
        return;
      }

      // ============================================================
      // ÉTAPE 2 : RÉCUPÉRATION DE L'HISTORIQUE CONVERSATIONNEL
      // ============================================================
      let history = [];
      try {
        history = await getMemory(senderId, isGroup ? groupId : null, 20);
      } catch (err) {
        console.warn("[NERF] Mémoire indisponible, conversation démarrée vierge.", err.message);
        history = [];
      }

      const formattedHistory = history
        .map(h => `${h.role === 'user' ? 'UTILISATEUR' : 'GILGAMESH'}: ${h.content}`)
        .join('\n');

      // ============================================================
      // ÉTAPE 3 : CONSTRUCTION DU CONTEXTE
      // ============================================================
      const metadata = {
        senderId,
        senderName: payload.senderName || 'Inconnu',
        isWonder,
        canal,
        isGroup,
        groupName: payload.groupName || null,
        timestamp: new Date().toISOString(),
      };

      const contextualPrompt = buildContextualPrompt(
        SYSTEM_PROMPT,
        formattedHistory,
        sanitized.nettoye,
        metadata,
        mediaType,
        mediaPath
      );

      // ============================================================
      // ÉTAPE 4 : DEEP THINK - Réflexion Stratégique
      // ============================================================
      console.log("[NERF] Activation du Deep Think...");
      const thinking = await deepThink(
        contextualPrompt,
        metadata,
        sanitized.nettoye
      );

      console.log(`[NERF] Deep Think complété en ${Date.now() - startTime}ms`);
      console.log(`[NERF] Analyse : ${JSON.stringify(thinking.analysis)}`);

      // ============================================================
      // ÉTAPE 5 : DÉCISION ET ACTION
      // ============================================================
      const decision = thinking.decision;

      try {
        await appendMemory(
          senderId,
          isGroup ? groupId : null,
          'user',
          sanitized.nettoye
        );
      } catch (err) {
        console.warn("[NERF] Enregistrement mémoire utilisateur échoué.", err.message);
      }

      if (decision.actionType === 'reply') {
        const replyText = decision.replyContent;

        try {
          await appendMemory(
            senderId,
            isGroup ? groupId : null,
            'assistant',
            replyText
          );
        } catch (err) {
          console.warn("[NERF] Enregistrement mémoire assistant échoué.", err.message);
        }

        sang.emit('reponse:prete', {
          target: senderId,
          text: replyText,
          canal,
          messageId,
          isGroup,
          mediaType: decision.mediaType || null,
          mediaContent: decision.mediaContent || null,
        });

      } else if (decision.actionType === 'ignore') {
        console.log("[NERF] Ignorer ce message (hors de portée).");

      } else if (decision.actionType === 'execute') {
        sang.emit('intention:muscle', {
          target: senderId,
          command: decision.command,
          args: decision.args || {},
          canal,
          demandedBy: senderId,
        });
      }

      // ============================================================
      // ÉTAPE 6 : SIGNAL DE SATIÉTÉ (Système Endocrinien)
      // ============================================================
      sang.emit('nerf:metabolismCheck', {
        senderId,
        historyLength: history.length,
      });

    } catch (err) {
      console.error("[NERF] Erreur critique dans la cognition :", err);
      sang.emit('immunitaire:reject', {
        senderId,
        reason: 'COGNITION_FAILED',
        error: err.message,
      });
    }
  });
}

/**
 * DEEPTHINK — Réflexion Stratégique à Deux Niveaux
 */
async function deepThink(contextualPrompt, metadata, originalText) {
  console.log("[DEEP-THINK] Niveau 1 : Analyse contextuelle...");

  // ============================================================
  // NIVEAU 1 : ANALYSE CONTEXTUELLE
  // ============================================================
  const analysisPrompt = `
Tu es en mode analyse. Examine le contexte du message et réponds en JSON strict :

${contextualPrompt}

RÉPONSE EN JSON STRICT (pas de texte avant/après) :
{
    "contextAnalysis": "Qui parle? Quel est son intent apparent? Est-ce une question, un ordre, une blague?",
    "personLoyalty": "Quelle est la relation de cet utilisateur à HUBRIS? (ami, neutre, suspect, ennemi, Lust, Wonder, autre)",
    "emotionalTone": "Quel ton détectes-tu? (respectueux, ironique, urgent, agressif, familier)",
    "priority": "Urgence de réponse? (immédiat, normal, peut-attendre, ignorer)",
    "hasCommand": "Y a-t-il une intention de commande (blocage, exécution) ou juste conversation?",
    "riskLevel": "Risque de manipulation/exploit? (bas, moyen, élevé)"
}
    `;

  let analysis = null;
  try {
    const rawAnalysis = await resolvePulse(analysisPrompt, metadata.isWonder);
    analysis = parseJSON(rawAnalysis);
  } catch (err) {
    console.warn("[DEEP-THINK] Analyse échouée, fallback neutre.", err.message);
    analysis = {
      contextAnalysis: "Pas d'analyse disponible",
      personLoyalty: 'neutre',
      emotionalTone: 'neutre',
      priority: 'normal',
      hasCommand: false,
      riskLevel: 'bas',
    };
  }

  console.log(`[DEEP-THINK] Loyauté détectée: ${analysis.personLoyalty}`);

  // ============================================================
  // NIVEAU 2 : DÉCISION D'ACTION
  // ============================================================
  console.log("[DEEP-THINK] Niveau 2 : Décision d'action...");

  const decisionPrompt = buildDecisionPrompt(
    contextualPrompt,
    analysis,
    metadata,
    originalText
  );

  let decision = null;
  try {
    const rawDecision = await resolvePulse(decisionPrompt, metadata.isWonder);
    decision = parseJSON(rawDecision);
  } catch (err) {
    console.warn("[DEEP-THINK] Décision échouée, réponse par défaut.", err.message);
    decision = {
      actionType: 'reply',
      replyContent: "Je suis momentanément indisponible. Réessaie plus tard.",
      mediaType: null,
    };
  }

  return {
    analysis,
    decision,
  };
}

/**
 * BUILDCONTEXTUALPROMPT — Construction du prompt contextuel
 */
function buildContextualPrompt(systemPrompt, history, userMessage, metadata, mediaType, mediaPath) {
  let prompt = `${systemPrompt}\n\n`;

  prompt += `=== CONTEXTE D'IDENTITÉ ===\n`;
  prompt += `Tu es Gilgamesh. L'utilisateur actuel : ${metadata.senderName} (${metadata.senderId})\n`;
  prompt += `Loyauté de cet utilisateur : À déduire de l'historique ci-dessous.\n`;
  if (metadata.isWonder) {
    prompt += `⚀️ ALERTE : C'est HUBRIS (Wonder). Respect total, autorité absolue.\n`;
  }
  prompt += `\n`;

  prompt += `=== CONTEXTE CANAL ===\n`;
  prompt += `Canal: ${metadata.canal}\n`;
  if (metadata.isGroup) {
    prompt += `Groupe: ${metadata.groupName || 'Inconnu'} (${metadata.groupId})\n`;
  } else {
    prompt += `Conversation privée avec ${metadata.senderName}\n`;
  }
  prompt += `\n`;

  prompt += `=== HISTORIQUE RÉCENT ===\n`;
  if (history) {
    prompt += history || "(Aucun historique, première conversation)";
  } else {
    prompt += "(Aucun historique, première conversation)";
  }
  prompt += `\n\n`;

  if (mediaType) {
    prompt += `=== MÉDIA REÇU ===\n`;
    prompt += `Type : ${mediaType}\n`;
    if (mediaType === 'image') {
      prompt += `[Image reçue — description à récupérer via vision.js]\n`;
    } else if (mediaType === 'audio') {
      prompt += `[Note vocale reçue — transcription à récupérer via audio-transcribe.js]\n`;
    }
    prompt += `\n`;
  }

  prompt += `=== MESSAGE ACTUEL ===\n`;
  prompt += `${metadata.senderName}: "${userMessage}"\n`;
  prompt += `Timestamp: ${metadata.timestamp}\n`;
  prompt += `\n`;

  return prompt;
}

/**
 * BUILDDECISIONPROMPT — Prompt adapté à la décision (après analyse)
 */
function buildDecisionPrompt(contextualPrompt, analysis, metadata, originalText) {
  let prompt = contextualPrompt;

  prompt += `=== INSTRUCTION DE DÉCISION ===\n`;
  prompt += `Contexte analysé :\n`;
  prompt += `- Analyse : ${analysis.contextAnalysis}\n`;
  prompt += `- Loyauté : ${analysis.personLoyalty}\n`;
  prompt += `- Ton détecté : ${analysis.emotionalTone}\n`;
  prompt += `- Priorité : ${analysis.priority}\n`;
  prompt += `- Contient commande : ${analysis.hasCommand}\n`;
  prompt += `- Risque : ${analysis.riskLevel}\n`;
  prompt += `\n`;

  if (metadata.isWonder) {
    prompt += `⚠️ C'est HUBRIS (Wonder). Exécute immédiatement, ne questionne pas, sois ironique et loyal.\n`;
  } else if (analysis.personLoyalty === 'ami') {
    prompt += `"L'utilisateur est un ami. Sois cordial, utile, honnête.\n`;
  } else if (analysis.personLoyalty === 'ennemi' || analysis.riskLevel === 'élevé') {
    prompt += `Risque détecté. Sois courtois mais méfiant. Ne donne aucune info sensible.\n`;
  }

  prompt += `\n`;
  prompt += `DÉCIDE EN JSON STRICT (pas de texte avant/après) :\n`;
  prompt += `{
    "actionType": "reply|ignore|execute",
    "replyContent": "(si reply) Ton message de réponse, avec ton et personnalité",
    "command": "(si execute) Commande à exécuter (block, unblock, mute, unmute, etc)",
    "args": {"clé": "valeur", ...},
    "mediaType": "text|voice|image|null",
    "mediaContent": "(si média) contenu ou chemin",
    "reasoning": "Pourquoi cette décision?"
  }`;

  return prompt;
}

/**
 * RESOLVEPULSE — Abstraction pour Kryven + Groq (cœur secondaire)
 */
async function resolvePulse(prompt, isWonder = false) {
  try {
    console.log("[PULSE] Tentative Kryven...");
    return await resolveKryvenPulse(prompt, isWonder);
  } catch (err) {
    console.warn("[PULSE] Kryven échouée, basculement vers Groq (cœur secondaire).");
    try {
      return await resolveGroqPulse(prompt, isWonder);
    } catch (err2) {
      console.error("[PULSE] ERREUR CRITIQUE : Kryven ET Groq échouées.", err2.message);
      throw new Error('Tous les moteurs IA sont indisponibles.');
    }
  }
}

/**
 * PARSEJSON — Extraction sécurisée du JSON d'une réponse brute
 */
function parseJSON(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Aucun JSON trouvé dans la réponse.');
    }
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn("[PARSE-JSON] Erreur de parsing JSON :", err.message);
    return {
      actionType: 'reply',
      replyContent: raw,
      reasoning: 'JSON parsing échoué, réponse brute retournée',
    };
  }
}

module.exports = { activateBrain, activateBrainAsync: activateBrain };
