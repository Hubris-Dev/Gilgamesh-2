// core/kryven-client.js
// CLIENT IA — Kryven + Mistral AI (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Mistral prend le relais.

import axios from 'axios';
import { sang } from './heartbeat.js';

const KRYVEN_MODEL = 'kryven-uncensored-v2';
const MISTRAL_MODEL_PRIMARY = 'mistral-large-latest';
const MISTRAL_MODEL_FALLBACK = 'mistral-small-latest';

// Réponses statiques pour le mode dégradé
const FALLBACK_REPLIES = [
  `Je ne suis pas en état de répondre pour l'instant. Un problème technique m'empêche de t'assister. Reviens plus tard.`,
  `Mistral et Kryven sont hors de ma portée. Je reviendrai quand le circuit sera rétabli.`,
  `Techniquement indisponible. Je te préviendrai quand je serai de nouveau prêt à répondre.`,
];

/**
 * GETCONFIG — lit les variables d'environnement…à chaque appel
 */
function getConfig() {
  return {
    kryvenApiKey: process.env.KRYVEN_API_KEY || '',
    mistralApiKey: process.env.MISTRAL_API_KEY || '',
    kryvenBaseUrl: process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1',
    mistralBaseUrl: 'https://api.mistral.ai/v1',
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
export async function resolveKryvenPulse(prompt, isWonder = false, schema = null) {
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
 * APPELMISTRAL — Appel bas niveau à un modèle donné via Mistral AI.
 * NOTE : Mistral supporte response_format: {"type": "json_object"} pour
 * garantir un JSON valide (mode "JSON mode" classique), mais pas encore le
 * strict json_schema à la OpenAI sur tous les modèles — d'où le filet de
 * sécurité parseJSON côté brain.js qui reste indispensable.
 */
async function appelMistral(model, prompt, isWonder, schema) {
  const { mistralApiKey, mistralBaseUrl } = getConfig();

  if (!mistralApiKey) {
    throw new Error('Mistral API key not configured');
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: isWonder ? 0.9 : 0.7,
    max_tokens: 2048,
    top_p: 0.95,
  };

  if (schema) {
    body.response_format = { type: 'json_object' };
  }

  const response = await axios.post(
    `${mistralBaseUrl}/chat/completions`,
    body,
    {
      headers: {
        'Authorization': `Bearer ${mistralApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error(`Réponse Mistral (${model}) vide ou malformée`);
  }

  return response.data.choices[0].message.content;
}

/**
 * RESOLVEGROQ_PULSE — Appel au Cœur Secondaire (nom conservé pour ne pas
 * casser l'import dans brain.js, même si le moteur réel est maintenant
 * Mistral et non plus Groq).
 * Essaie Mistral Large en premier, puis Mistral Small si le premier échoue
 * (rate-limit sur le tier gratuit, timeout, etc.).
 */
export async function resolveGroqPulse(prompt, isWonder = false, schema = null) {
  console.log('[MISTRAL] Cœur Secondaire activé — tentative Large...' + (schema ? ' (structured output)' : ''));

  try {
    const content = await appelMistral(MISTRAL_MODEL_PRIMARY, prompt, isWonder, schema);
    console.log('[MISTRAL] Réponse reçue (Large).');
    return content;
  } catch (err) {
    console.warn('[MISTRAL] Large indisponible :', describeAxiosError(err), '— bascule sur Small.');
  }

  try {
    const content = await appelMistral(MISTRAL_MODEL_FALLBACK, prompt, isWonder, schema);
    console.log('[MISTRAL] Réponse reçue (Small, secours).');
    return content;
  } catch (err) {
    console.error('[MISTRAL] Erreur :', describeAxiosError(err));
    throw err;
  }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Mistral
 */
export async function resolvePulse(prompt, isWonder = false, schema = null) {
  try {
    return await resolveKryvenPulse(prompt, isWonder, schema);
  } catch (kryvenErr) {
    console.warn('[PULSE] Kryven indisponible — passage au moteur secondaire.');

    try {
      return await resolveGroqPulse(prompt, isWonder, schema);
    } catch (mistralErr) {
      console.error('[PULSE] TOUS les moteurs IA SONT HORS-SITE:', mistralErr.message);
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
export function initializeKryvenClient() {
  console.log('[KRYVEN-CLIENT] Initialisation...');

  const { kryvenApiKey, mistralApiKey } = getConfig();

  if (kryvenApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
  }

  if (mistralApiKey) {
    console.log('[KRYVEN-CLIENT] ✓ Clé Mistral détectée (Cœur Secondaire).');
  } else {
    console.warn('[KRYVEN-CLIENT] ⚠️ Clé Mistral manquante.');
  }

  if (!kryvenApiKey && !mistralApiKey) {
    console.error('[KRYVEN-CLIENT] ⚠️  MODE DEGRADÉ : Aucun moteur IA disponible!');
    console.error('[KRYVEN-CLIENT] Gilgamesh tourne sans IA - réponses statiques.');
    try {
      sang.emit('kryven:degrade', { raison: 'AUCUN_MOTEUR' });
    } catch (_) { /* Sang indisponible */ }
  }

  console.log('[KRYVEN-CLIENT] Prêt.');
}

export function generateStaticReply() {
  return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}

export function isIADegraded() {
  const { kryvenApiKey, mistralApiKey } = getConfig();
  return !kryvenApiKey && !mistralApiKey;
}

export function setSettings(config) {
  if (config.kryvenApiKey) process.env.KRYVEN_API_KEY = config.kryvenApiKey;
  if (config.mistralApiKey) process.env.MISTRAL_API_KEY = config.mistralApiKey;
  if (config.kryvenBaseUrl) process.env.KRYVEN_BASE_URL = config.kryvenBaseUrl;
  console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

export function getStatus() {
  const { kryvenApiKey, mistralApiKey } = getConfig();
  return {
    kryvenAvailable: !!kryvenApiKey,
    mistralAvailable: !!mistralApiKey,
    kryvenModel: KRYVEN_MODEL,
    mistralModelPrimary: MISTRAL_MODEL_PRIMARY,
    mistralModelFallback: MISTRAL_MODEL_FALLBACK,
  };
}
