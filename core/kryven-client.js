// core/kryven-client.js
// CLIENT IA — Kryven + Groq (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Groq prend le relais.
// EXTENSION : meme si aucun moteur IA n'est disponible,
// Gilgamesh ne crash pas. Il continue en mode dégradé.

const axios = require('axios');

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const GROQ_MODEL = 'openai/gpt-oss-120b';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  `Je ne suis pas en état de répondre pour l'instant. Un problème technique m'empêche de t'assister. Reviens plus tard.`,
  `Groq et Kryven sont hors de ma portée. Je reviendrai quand le circuit sera rétabli.`,
  `Techniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.`,
];

/**
 * GETCONFIG — lit les variables d'environnement…à chaque appel
 * pour toujours avoir la valeur la plus récente.
 */
function getConfig() {
  return {
    kryvenApiKey: process.env.KRYVEN_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    kryvenBaseUrl: process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1',
    groqBaseUrl: 'https://api.groq.com/openai/v1',
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
 * RESOLVEGROQ_PULSE — Appel au moteur Groq (Cœur Secondaire)
 * NOUVEAU : accepte un `schema` optionnel — { name, schema } — pour activer
 * les Structured Outputs de Groq (response_format: json_schema, strict:
 * true). Le modèle est alors contraint AU NIVEAU DU TOKEN à produire un JSON
 * qui respecte exactement ce schéma : plus de champ manquant, plus de JSON
 * malformé, plus besoin du parsing par regex en filet de secours (même s'il
 * reste là par prudence).
 */
async function resolveGroqPulse(prompt, isWonder = false, schema = null) {
  const { groqApiKey, groqBaseUrl } = getConfig();

  if (!groqApiKey) {
    throw new Error('Groq API key not configured');
  }

  console.log('[GROQ] Cœur Secondaire activé. Envoi du prompt...' + (schema ? ' (structured output)' : ''));

  try {
    const body = {
      model: GROQ_MODEL,
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
      `${groqBaseUrl}/chat/completions`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Réponse Groq vide ou malformée');
    }

    console.log('[GROQ] Réponse reçue (via Cœur Secondaire).');
    return response.data.choices[0].message.content;

  } catch (err) {
    console.error('[GROQ] Erreur :', describeAxiosError(err));
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

  const { kryvenApiKey, groqApiKey } = getConfig();

  if (kryvenApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
  }

  if (groqApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Groq détectée (Cœur Secondaire).');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Groq manquante.');
  }

  if (!kryvenApiKey && !groqApiKey) {
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
  const { kryvenApiKey, groqApiKey } = getConfig();
  return !kryvenApiKey && !groqApiKey;
}

function setSettings(config) {
  if (config.kryvenApiKey) process.env.KRYVEN_API_KEY = config.kryvenApiKey;
  if (config.groqApiKey) process.env.GROQ_API_KEY = config.groqApiKey;
  if (config.kryvenBaseUrl) process.env.KRYVEN_BASE_URL = config.kryvenBaseUrl;
  console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

function getStatus() {
  const { kryvenApiKey, groqApiKey } = getConfig();
  return {
    kryvenAvailable: !!kryvenApiKey,
    groqAvailable: !!groqApiKey,
    kryvenModel: KRYVEN_MODEL,
    groqModel: GROQ_MODEL,
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
