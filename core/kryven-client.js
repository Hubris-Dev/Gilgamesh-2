// core/kryven-client.js
// CLIENT IA — Kryven + Together AI (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Together AI prend le relais.

const axios = require('axios');

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const TOGETHER_MODEL_PRIMARY = 'meta-llama/Llama-3.1-405b-instruct';
const TOGETHER_MODEL_FALLBACK = 'meta-llama/Llama-3-70b-chat-hf';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  `Je ne suis pas en état de répondre pour l'instant. Un problème technique m'empêche de t'assister. Reviens plus tard.`,
  `Together AI et Kryven sont hors de ma portée. Je reviendrai quand le circuit sera rétabli.`,
  `Techniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.`,
];

/**
 * GETCONFIG — lit les variables d'environnement…à chaque appel
 */
function getConfig() {
  return {
    kryvenApiKey: process.env.KRYVEN_API_KEY || '',
    togetherApiKey: process.env.TOGETHER_API_KEY || '',
    kryvenBaseUrl: process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1',
    togetherBaseUrl: 'https://api.together.ai/v1',
  };
}

/**
 * Formate une erreur axios pour logger la vraie cause
 */
function describeAxiosError(err) {
  if (err.response) {
    return `status ${err.response.status} — ${JSON.stringify(err.response.data)}`;
  }
  return err.message;
}

/**
 * RESOLVEKRYVEN_PULSE — Appel au moteur Kryven
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
 * APPELTOGETHERAI — Appel bas niveau à un modèle donné via Together AI.
 */
async function appelTogetherAI(model, prompt, isWonder, schema) {
  const { togetherApiKey, togetherBaseUrl } = getConfig();

  if (!togetherApiKey) {
    throw new Error('Together AI API key not configured');
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
      type: 'json_object',
    };
  }

  const response = await axios.post(
    `${togetherBaseUrl}/chat/completions`,
    body,
    {
      headers: {
        'Authorization': `Bearer ${togetherApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error(`Réponse Together AI (${model}) vide ou malformée`);
  }

  return response.data.choices[0].message.content;
}

/**
 * RESOLVEGROQ_PULSE — Appel au Cœur Secondaire (nom conservé pour compatibilité)
 * Essaie Llama-3.1-405B en premier, puis Llama-3-70B si le premier échoue.
 */
async function resolveGroqPulse(prompt, isWonder = false, schema = null) {
  console.log('[TOGETHER] Cœur Secondaire activé — tentative Llama-3.1-405B...' + (schema ? ' (structured output)' : ''));

  try {
    const content = await appelTogetherAI(TOGETHER_MODEL_PRIMARY, prompt, isWonder, schema);
    console.log('[TOGETHER] Réponse reçue (Llama-3.1-405B).');
    return content;
  } catch (err) {
    console.warn('[TOGETHER] Llama-3.1-405B indisponible :', describeAxiosError(err), '— bascule sur Llama-3-70B.');
  }

  try {
    const content = await appelTogetherAI(TOGETHER_MODEL_FALLBACK, prompt, isWonder, schema);
    console.log('[TOGETHER] Réponse reçue (Llama-3-70B, secours).');
    return content;
  } catch (err) {
    console.error('[TOGETHER] Erreur :', describeAxiosError(err));
    throw err;
  }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Together AI
 */
async function resolvePulse(prompt, isWonder = false, schema = null) {
  try {
    return await resolveKryvenPulse(prompt, isWonder, schema);
  } catch (kryvenErr) {
    console.warn('[PULSE] Kryven indisponible — passage au moteur secondaire.');

    try {
      return await resolveGroqPulse(prompt, isWonder, schema);
    } catch (togetherErr) {
      console.error('[PULSE] TOUS les moteurs IA SONT HORS-SITE:', togetherErr.message);
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
 */
function initializeKryvenClient() {
  console.log('[KRYVEN-CLIENT] Initialisation...');

  const { kryvenApiKey, togetherApiKey } = getConfig();

  if (kryvenApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
  }

  if (togetherApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Together AI détectée (Cœur Secondaire).');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Together AI manquante.');
  }

  if (!kryvenApiKey && !togetherApiKey) {
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
  const { kryvenApiKey, togetherApiKey } = getConfig();
  return !kryvenApiKey && !togetherApiKey;
}

function setSettings(config) {
  if (config.kryvenApiKey) process.env.KRYVEN_API_KEY = config.kryvenApiKey;
  if (config.togetherApiKey) process.env.TOGETHER_API_KEY = config.togetherApiKey;
  if (config.kryvenBaseUrl) process.env.KRYVEN_BASE_URL = config.kryvenBaseUrl;
  console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

function getStatus() {
  const { kryvenApiKey, togetherApiKey } = getConfig();
  return {
    kryvenAvailable: !!kryvenApiKey,
    togetherAvailable: !!togetherApiKey,
    kryvenModel: KRYVEN_MODEL,
    togetherModelPrimary: TOGETHER_MODEL_PRIMARY,
    togetherModelFallback: TOGETHER_MODEL_FALLBACK,
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
