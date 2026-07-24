// core/kryven-client.js
// CLIENT IA — Kryven + OpenRouter (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. OpenRouter prend le relais.
// EXTENSION : meme si aucun moteur IA n'est disponible,
// Gilgamesh ne crash pas. Il continue en mode dégradé.
//
// CHANGEMENT : le Cœur Secondaire tournait avant sur Groq avec le modèle
// openai/gpt-oss-120b, dont l'alignement safety très strict refusait
// régulièrement des commandes légitimes ("je suis une IA, je ne peux pas
// faire ça") malgré le system prompt d'identité Gilgamesh. On bascule sur
// OpenRouter avec deux modèles moins réticents à suivre une persona/des
// instructions : Hermes-3-405B en priorité (fine-tuné par NousResearch
// spécifiquement pour être compliant aux system prompts), puis
// Llama-3.3-70B en secours si Hermes est indisponible/rate-limité.

const axios = require('axios');

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const OPENROUTER_MODEL_PRIMARY = 'nousresearch/hermes-3-llama-3.1-405b:free';
const OPENROUTER_MODEL_FALLBACK = 'meta-llama/llama-3.3-70b-instruct:free';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  `Je ne suis pas en état de répondre pour l'instant. Un problème technique m'empêche de t'assister. Reviens plus tard.`,
  `OpenRouter et Kryven sont hors de ma portée. Je reviendrai quand le circuit sera rétabli.`,
  `Techniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.`,
];

/**
 * GETCONFIG — lit les variables d'environnement…à chaque appel
 * pour toujours avoir la valeur la plus récente.
 */
function getConfig() {
  return {
    kryvenApiKey: process.env.KRYVEN_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    kryvenBaseUrl: process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  };
}

/**
 * Formate une erreur axios pour logger la vraie cause (statut + corps de
 * réponse de l'API), pas juste le message générique "Request failed with
 * status code 400".
 */
function describeAxiosError(err) {
  if (err.response) {
    return `status ${err.response.status} — ${JSON.stringify(err.response.data)}`;
  }
  return err.message;
}

/**
 * RESOLVEKRYVEN_PULSE — Appel au moteur Kryven
 * NOTE : Kryven est une API tierce dont on ne connaît pas le support exact
 * des Structured Outputs (response_format json_schema) — on n'y touche pas
 * pour ne pas casser un appel qui marche. Le paramètre schema est accepté
 * mais ignoré ici, utilisé uniquement côté Groq pour l'instant.
 */
async function resolveKryvenPulse(prompt, isWonder = false, schema = null) {
  const { kryvenApiKey, kryvenBaseUrl } = getConfig();

  if (!kryvenApiKey) {
    throw new Error('Kryven API key not configured');
  }

  console.log('[KRYVEN] Envoi du prompt...');

  try {
    const response = await axios.post(
      `${kryvenBaseUrl}/chat/completions`,
      {
        model: KRYVEN_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: isWonder ? 0.9 : 0.7,
        max_tokens: 2048,
        top_p: 0.95,
      },
      {
        headers: {
          'Authorization': `Bearer ${kryvenApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Réponse Kryven vide ou malformée');
    }

    console.log('[KRYVEN] Réponse reçue.');
    return response.data.choices[0].message.content;

  } catch (err) {
    console.error('[KRYVEN] Erreur :', describeAxiosError(err));
    throw err;
  }
}

/**
 * APPELOPENROUTER — Appel bas niveau à un modèle donné via OpenRouter.
 */
async function appelOpenRouter(model, prompt, isWonder, schema) {
  const { openrouterApiKey, openrouterBaseUrl } = getConfig();

  if (!openrouterApiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: isWonder ? 0.9 : 0.7,
    max_tokens: 2048,
    top_p: 0.95,
  };

  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: schema.name,
        schema: schema.schema,
        strict: true,
      },
    };
  }

  const response = await axios.post(
    `${openrouterBaseUrl}/chat/completions`,
    body,
    {
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
        // Recommandé par OpenRouter pour l'attribution des requêtes — sans
        // impact fonctionnel si absent, mais évite d'être dé-priorisé.
        'HTTP-Referer': 'https://gilgamesh.local',
        'X-Title': 'Gilgamesh-2',
      },
      timeout: 30000,
    }
  );

  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error(`Réponse OpenRouter (${model}) vide ou malformée`);
  }

  return response.data.choices[0].message.content;
}

/**
 * RESOLVEGROQ_PULSE — Appel au Cœur Secondaire (nom conservé pour ne pas
 * casser l'import dans brain.js, même si le moteur réel est maintenant
 * OpenRouter et non plus Groq).
 * Essaie Hermes-3-405B en premier (compliant aux system prompts, peu de
 * refus), puis bascule sur Llama-3.3-70B si Hermes échoue ou est
 * rate-limité (fréquent sur le tier gratuit avec un modèle 405B).
 */
async function resolveGroqPulse(prompt, isWonder = false, schema = null) {
  console.log('[OPENROUTER] Cœur Secondaire activé — tentative Hermes-3...' + (schema ? ' (structured output)' : ''));

  try {
    const content = await appelOpenRouter(OPENROUTER_MODEL_PRIMARY, prompt, isWonder, schema);
    console.log('[OPENROUTER] Réponse reçue (Hermes-3).');
    return content;
  } catch (err) {
    console.warn('[OPENROUTER] Hermes-3 indisponible :', describeAxiosError(err), '— bascule sur Llama-3.3.');
  }

  try {
    const content = await appelOpenRouter(OPENROUTER_MODEL_FALLBACK, prompt, isWonder, schema);
    console.log('[OPENROUTER] Réponse reçue (Llama-3.3, secours).');
    return content;
  } catch (err) {
    console.error('[OPENROUTER] Erreur :', describeAxiosError(err));
    throw err;
  }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Groq
 */
async function resolvePulse(prompt, isWonder = false, schema = null) {
  try {
    return await resolveKryvenPulse(prompt, isWonder, schema);
  } catch (kryvenErr) {
    console.warn('[PULSE] Kryven indisponible — passage au moteur secondaire.');

    try {
      return await resolveGroqPulse(prompt, isWonder, schema);
    } catch (groqErr) {
      console.error('[PULSE] TOUS les moteurs IA SONT HORS-SITE:', groqErr.message);
      const { sang } = require('./heartbeat');
      const reponse = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      sang.emit('cortex:auto-quit', {
        raison: 'tous moteurs IA Indisponibles',
        reponse,
      });
      return reponse;
    }
  }
}

/**
 * INITIALIZEKRYVENCLIENT — Vérifie les clé API et initialise
 * Loi 4 : si aucun moteur n'est disponible, signale le mode dégradé
 * au lieu de crasher le process.
 */
function initializeKryvenClient() {
  console.log('[KRYVEN-CLIENT] Initialisation...');

  const { kryvenApiKey, openrouterApiKey } = getConfig();

  if (kryvenApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
  }

  if (openrouterApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé OpenRouter détectée (Cœur Secondaire).');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé OpenRouter manquante.');
  }

  if (!kryvenApiKey && !openrouterApiKey) {
    console.error('[KRYVEN-CLIENT] ⚠️  MODE DEGRADÉ : Aucun moteur IA disponible!');
    console.error('[KRYVEN-CLIENT] Gilgamesh tourne sans IA - réponses statiques.');
    try {
      const { sang } = require('./heartbeat');
      sang.emit('kryven:degrade', { raison: 'AUCUN_MOTEUR' });
    } catch (_) { /* heartbeat pas encore chargé */ }
  }

  console.log('[KRYVEN-CLIENT] Prêt.');
}

function generateStaticReply() {
  return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}

function isIADegraded() {
  const { kryvenApiKey, openrouterApiKey } = getConfig();
  return !kryvenApiKey && !openrouterApiKey;
}

function setSettings(config) {
  if (config.kryvenApiKey) process.env.KRYVEN_API_KEY = config.kryvenApiKey;
  if (config.openrouterApiKey) process.env.OPENROUTER_API_KEY = config.openrouterApiKey;
  if (config.kryvenBaseUrl) process.env.KRYVEN_BASE_URL = config.kryvenBaseUrl;
  console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

function getStatus() {
  const { kryvenApiKey, openrouterApiKey } = getConfig();
  return {
    kryvenAvailable: !!kryvenApiKey,
    openrouterAvailable: !!openrouterApiKey,
    kryvenModel: KRYVEN_MODEL,
    openrouterModelPrimary: OPENROUTER_MODEL_PRIMARY,
    openrouterModelFallback: OPENROUTER_MODEL_FALLBACK,
  };
}

module.exports = {
  resolveKryvenPulse,
  resolveGroqPulse,
  resolvePulse,
  initializeKryvenClient,
  generateStaticReply,
  setSettings,
  getStatus,
  isIADegraded,
};
