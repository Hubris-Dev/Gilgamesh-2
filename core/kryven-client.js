// core/kryven-client.js
// CLIENT IA — Kryven + Venice AI (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Venice AI prend le relais.
//
// Venice AI : API OpenAI-compatible, modèles uncensored (sécurité retirée par
// design, pas "juste moins censurée"). Parfait pour Gilgamesh — la persona a
// le contrôle total, pas d'alignement de sécurité qui se met en travers.

const axios = require('axios');

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const VENICE_MODEL = 'venice-uncensored';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  `Je ne suis pas en état de répondre pour l'instant. Un problème technique m'empêche de t'assister. Reviens plus tard.`,
  `Venice et Kryven sont hors de ma portée. Je reviendrai quand le circuit sera rétabli.`,
  `Techniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.`,
];

/**
 * GETCONFIG — lit les variables d'environnement…à chaque appel
 */
function getConfig() {
  return {
    kryvenApiKey: process.env.KRYVEN_API_KEY || '',
    veniceApiKey: process.env.VENICE_API_KEY || '',
    kryvenBaseUrl: process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1',
    veniceBaseUrl: 'https://api.venice.ai/api/v1',
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
 * RESOLEVENIC_PULSE — Appel au moteur Venice AI (Cœur Secondaire)
 * Venice uncensored : pas de filtres de sécurité, la persona (Gilgamesh) a
 * le contrôle total. Parfait pour un bot autonome sans refus déguisés.
 */
async function resolveGroqPulse(prompt, isWonder = false, schema = null) {
  const { veniceApiKey, veniceBaseUrl } = getConfig();

  if (!veniceApiKey) {
    throw new Error('Venice API key not configured');
  }

  console.log('[VENICE] Cœur Secondaire activé. Envoi du prompt...' + (schema ? ' (structured output)' : ''));

  try {
    const body = {
      model: VENICE_MODEL,
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
      `${veniceBaseUrl}/chat/completions`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${veniceApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Réponse Venice vide ou malformée');
    }

    console.log('[VENICE] Réponse reçue (via Cœur Secondaire).');
    return response.data.choices[0].message.content;

  } catch (err) {
    console.error('[VENICE] Erreur :', describeAxiosError(err));
    throw err;
  }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Venice AI
 */
async function resolvePulse(prompt, isWonder = false, schema = null) {
  try {
    return await resolveKryvenPulse(prompt, isWonder, schema);
  } catch (kryvenErr) {
    console.warn('[PULSE] Kryven indisponible — passage au moteur secondaire.');

    try {
      return await resolveGroqPulse(prompt, isWonder, schema);
    } catch (veniceErr) {
      console.error('[PULSE] TOUS les moteurs IA SONT HORS-SITE:', veniceErr.message);
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

  const { kryvenApiKey, veniceApiKey } = getConfig();

  if (kryvenApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
  }

  if (veniceApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Venice AI détectée (Cœur Secondaire).');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Venice AI manquante.');
  }

  if (!kryvenApiKey && !veniceApiKey) {
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
  const { kryvenApiKey, veniceApiKey } = getConfig();
  return !kryvenApiKey && !veniceApiKey;
}

function setSettings(config) {
  if (config.kryvenApiKey) process.env.KRYVEN_API_KEY = config.kryvenApiKey;
  if (config.veniceApiKey) process.env.VENICE_API_KEY = config.veniceApiKey;
  if (config.kryvenBaseUrl) process.env.KRYVEN_BASE_URL = config.kryvenBaseUrl;
  console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

function getStatus() {
  const { kryvenApiKey, veniceApiKey } = getConfig();
  return {
    kryvenAvailable: !!kryvenApiKey,
    veniceAvailable: !!veniceApiKey,
    kryvenModel: KRYVEN_MODEL,
    veniceModel: VENICE_MODEL,
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
