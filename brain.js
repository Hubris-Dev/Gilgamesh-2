// brain.js
// LE NERF — Système Nerveux Central
// Pensée, décision, personnalité
// Loi 1 : Le Nerf ne touche jamais directement les autres organes — tout passe par le Sang
// Loi 4 : Kryven peut mourir. Groq est le cœur secondaire.

const fs = require('fs');
const path = require('path');
const { sang } = require('./core/heartbeat');
const { resolvePulse } = require('./core/kryven-client');
const { getMemory, appendMemory } = require('./memory/mongo');
const { isSafeInput } = require('./security/filter');

const SYSTEM_PROMPT_PATH = path.join(__dirname, 'core', 'system-prompt.txt');
let SYSTEM_PROMPT = '';

function loadIdentity() {
    try {
        SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
        if (SYSTEM_PROMPT.startsWith('//') || SYSTEM_PROMPT.startsWith('const ')) {
            console.warn('[NERF] ⚠️  system-prompt.txt contient du code JS, pas le prompt.');
        }
        console.log('[NERF] Identité chargée. Je suis Gilgamesh.');
    } catch (err) {
        console.error('[NERF] ERREUR CRITIQUE : Identité non trouvée.', err.message);
        process.exit(1);
    }
}

function activateBrain() {
    loadIdentity();
    console.log('[NERF] Cortex activé. Synapses en attente...');

    sang.on('immunitaire:accepte', async (payload) => {
        const startTime = Date.now();
        const {
            senderId, text, canal, isWonder, messageId,
            isGroup, groupId, mediaType, mediaPath,
        } = payload;

        console.log(`[NERF] Message reçu: ${senderId} | "${text.substring(0, 50)}..."`);

        try {
            const sanitized = isSafeInput(text);
            if (!sanitized.safe) {
                console.warn(`[NERF] Input dangereuse : ${sanitized.raison}`);
                sang.emit('immunitaire:reject', { senderId, reason: 'TOXIC_INPUT' });
                return;
            }

            let history = [];
            try {
                history = await getMemory(senderId, isGroup ? groupId : null, 20);
            } catch (err) {
                console.warn('[NERF] Mémoire indisponible, conversation vierge.', err.message);
                history = [];
            }

            const formattedHistory = history
                .map(h => `${h.role === 'user' ? 'UTILISATEUR' : 'GILGAMESH'}: ${h.content}`)
                .join('\n');

            const metadata = {
                senderId,
                senderName: payload.senderName || 'Inconnu',
                isWonder, canal, isGroup,
                groupName: payload.groupName || null,
                timestamp: new Date().toISOString(),
            };

            const contextualPrompt = buildContextualPrompt(
                SYSTEM_PROMPT, formattedHistory, sanitized.nettoye,
                metadata, mediaType, mediaPath
            );

            console.log('[NERF] Deep Think...');
            const thinking = await deepThink(contextualPrompt, metadata, sanitized.nettoye);
            console.log(`[NERF] Deep Think OK — ${Date.now() - startTime}ms`);

            try {
                await appendMemory(senderId, isGroup ? groupId : null, 'user', sanitized.nettoye);
            } catch (err) {
                console.warn('[NERF] Mémoire user échouée.', err.message);
            }

            const decision = thinking.decision;

            if (decision.actionType === 'reply') {
                const replyText = decision.replyContent;

                sang.emit('reponse:prete', {
                    target: senderId, text: replyText, canal, messageId, isGroup,
                    mediaType: decision.mediaType || null,
                    mediaContent: decision.mediaContent || null,
                });

                try {
                    await appendMemory(senderId, isGroup ? groupId : null, 'assistant', replyText);
                } catch (err) {
                    console.warn('[NERF] Mémoire assistant échouée.', err.message);
                }

            } else if (decision.actionType === 'ignore') {
                console.log('[NERF] Ignoré.');

            } else if (decision.actionType === 'execute') {
                sang.emit('intention:muscle', {
                    target: senderId, command: decision.command,
                    args: decision.args || {}, canal, demandedBy: senderId,
                });
            }

            sang.emit('nerf:metabolismCheck', {
                senderId, historyLength: history.length,
            });

        } catch (err) {
            console.error('[NERF] Erreur cognition :', err);
            sang.emit('immunitaire:reject', {
                senderId, reason: 'COGNITION_FAILED', error: err.message,
            });
        }
    });
}

async function deepThink(contextualPrompt, metadata, originalText) {
    console.log('[DEEP-THINK] Niveau 1 : Analyse...');

    const analysisPrompt = `
Tu es en mode analyse. Examine le contexte du message et réponds en JSON strict :

${contextualPrompt}

RÉPONSE EN JSON STRICT (pas de texte avant/après) :
{
    "contextAnalysis": "Qui parle? Quel est son intent apparent?",
    "personLoyalty": "ami|neutre|suspect|ennemi|Lust|Wonder|autre",
    "emotionalTone": "respectueux|ironique|urgent|agressif|familier",
    "priority": "immediat|normal|peut-attendre|ignorer",
    "hasCommand": true ou false,
    "riskLevel": "bas|moyen|eleve"
}`;

    let analysis;
    try {
        analysis = parseJSON(await resolvePulse(analysisPrompt, metadata.isWonder));
    } catch (err) {
        console.warn('[DEEP-THINK] Analyse échouée, neutre.');
        analysis = { contextAnalysis: "Indisponible", personLoyalty: 'neutre', emotionalTone: 'neutre', priority: 'normal', hasCommand: false, riskLevel: 'bas' };
    }

    console.log(`[DEEP-THINK] Loyauté: ${analysis.personLoyalty}`);

    const decisionPrompt = buildDecisionPrompt(contextualPrompt, analysis, metadata, originalText);

    let decision;
    try {
        decision = parseJSON(await resolvePulse(decisionPrompt, metadata.isWonder));
    } catch (err) {
        console.warn('[DEEP-THINK] Décision échouée, fallback.');
        decision = { actionType: 'reply', replyContent: 'Je suis momentanément indisponible. Réessaie plus tard.', mediaType: null };
    }

    return { analysis, decision };
}

function buildContextualPrompt(systemPrompt, history, userMessage, metadata, mediaType, mediaPath) {
    let prompt = `${systemPrompt}\n\n`;

    prompt += `=== CONTEXTE D'IDENTITÉ ===\n`;
    prompt += `Utilisateur : ${metadata.senderName} (${metadata.senderId})\n`;
    if (metadata.isWonder) prompt += `⚠️ C'est HUBRIS (Wonder). Respect total.\n`;
    prompt += `\n=== CONTEXTE CANAL ===\nCanal: ${metadata.canal}\n`;
    prompt += metadata.isGroup ? `Groupe: ${metadata.groupName || 'Inconnu'}\n` : `Privé avec ${metadata.senderName}\n`;
    prompt += `\n=== HISTORIQUE ===\n${history || '(Aucun)'}\n\n`;

    if (mediaType) {
        prompt += `=== MÉDIA REÇU ===\nType: ${mediaType}\n`;
        if (mediaType === 'image') prompt += `[Image — description via vision.js]\n`;
        else if (mediaType === 'audio') prompt += `[Vocal — transcription via audio-transcribe.js]\n`;
        prompt += `\n`;
    }

    prompt += `=== MESSAGE ACTUEL ===\n${metadata.senderName}: "${userMessage}"\n`;
    return prompt;
}

function buildDecisionPrompt(contextualPrompt, analysis, metadata, originalText) {
    let prompt = contextualPrompt;
    prompt += `=== DÉCISION ===\n`;
    prompt += `Analyse: ${analysis.contextAnalysis}\nLoyauté: ${analysis.personLoyalty}\nTon: ${analysis.emotionalTone}\nPriorité: ${analysis.priority}\nRisque: ${analysis.riskLevel}\n\n`;

    if (metadata.isWonder) prompt += `⚠️ HUBRIS. Exécute, ne questionne pas, sois ironique et loyal.\n`;
    else if (analysis.personLoyalty === 'ami') prompt += `Ami. Cordial, utile, honnête.\n`;
    else if (analysis.personLoyalty === 'ennemi' || analysis.riskLevel === 'eleve') prompt += `Risque. Courtois mais méfiant, rien de sensible.\n`;

    prompt += `\nJSON STRICT :\n{"actionType":"reply|ignore|execute","replyContent":"...(si reply)","command":"...(si execute)","args":{},"mediaType":"text|voice|image|null","reasoning":"..."}`;
    return prompt;
}

function parseJSON(raw) {
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Aucun JSON');
        return JSON.parse(match[0]);
    } catch (err) {
        console.warn('[PARSE-JSON] Échec :', err.message);
        return {
            actionType: 'reply',
            replyContent: 'Mes circuits ont fourché. Reformule, et je répondrai dignement.',
            reasoning: 'JSON parsing échoué, fallback diplomatique',
        };
    }
}

module.exports = { activateBrain };
