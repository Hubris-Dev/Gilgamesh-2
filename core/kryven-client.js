// core/kryven-client.js
// CLIENT IA — Kryven + Groq (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Groq prend le relais.
  // EXTENSION : meme si aucun moteur IA n'est disponible,
  // Gilgamesh ne crash pas. Il continue en mode dégradé.

const axios = require('axios');

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const GROQ_MODEL = 'mixtral-8x7b-32768';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  'Je ne suis pas en état de répondre pour l'instant. Un problème technique mémèche de t'assister. Reviens plus tard.',
  'Groq et Kryven sont hoves de ma portée. Je reviendai quand le circuit sera rétabli.',
  'Téchniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.',
];

/**
 * GETCONFIG — lit les variables d'environnement †à chaque appel
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
 * RESOLVEKRYVEN_PULSE — Appel au moteur Kryven
 */
async function resolveKryvenPulse(prompt, isWonder = false) {
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
    console.error('[KRYVEN] Erreur :', err.message);
    throw err;
  }
}

/**
 * RESOLVEGROQ_PULSE — Appel au moteur Groq (Cœur Secondaire)
 */
async function resolveGroqPulse(prompt, isWonder = false) {
  const { groqApiKey, groqBaseUrl } = getConfig();

  if (!groqApiKey) {
    throw new Error('Groq API key not configured');
  }

  console.log('[GROQ] Cœur Secondaire activé. Envoi du prompt...');

  try {
    const response = await axios.post(
      `${groqBaseUrl}/chat/completions`,
      {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: isWonder ? 0.9 : 0.7,
        max_tokens: 2048,
        top_p: 0.95,
      },
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
    console.error('[GROQ] Erreur :', err.message);
    throw err;
  }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Groq
 */
async function resolvePulse(prompt, isWonder = false) {
  try {
    return await resolveKryvenPulse(prompt, isWonder);
  } catch (err) {
    console.warn('[PULSE] Kryven échoué. Basculement Groq...');
    return await resolveGroqPulse(prompt, isWonder);
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

  // Loi 4 : si aucun moteur, survire en mode dégradé
  if (!kryvenApiKey && !groqApiKey) {
    console.error('[KRYVEN-CLIENT] ⚠️  MODE DEGRADLÉ : Aucun moteur IA disponible!');
    console.error('[KRYVEN-CLIENT] Gilgamesh tourne sans IA - réponses statiques.');
    // ÉMettre un signal au Sang
    try {
      const { sang } = require('./heartbeat');
      sang.emit('kryven:degrade', { raison: 'AUCUN_MOTEUR' });
    } catch (_) { /* heartbeat pas encore chargé */ }
  }

  console.log('[KRYVEN-CLIENT] Prêt.');
}

/**
 * GENERATESTATICREPLY — réponse statique pour le mode dégradé
 */
function generateStaticReply() {
  return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}

/**
 * ISIADEGRADED — Dit si le mode dégradé est actif
 */
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
