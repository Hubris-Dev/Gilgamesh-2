// core/kryven-client.js
// CLIENT IA — Kryven + Groq (Cœur Secondaire)
// Abstraction pour appeler l'IA
// Loi 4 : Kryven peut mourir. Groq prend le relais.

const axios = require('axios');

// Variables globales pour les clés API
let KRYVEN_API_KEY = process.env.KRYVEN_API_KEY || '';
let GROQ_API_KEY = process.env.GROQ_API_KEY || '';
let KRYVEN_BASE_URL = process.env.KRYVEN_BASE_URL || 'https://api.kryven.com/v1';
let GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Modèles
const KRYVEN_MODEL = 'kryven-uncensored-v2'; // À adapter selon ta clé
const GROQ_MODEL = 'mixtral-8x7b-32768'; // Modèle gratuit Groq

/**
 * RESOLVEKRYVEN_PULSE — Appel au moteur Kryven
 * Utilisé en priorité, pour les réponses intelligentes et sans restriction
 */
async function resolveKryvenPulse(prompt, isWonder = false) {
    if (!KRYVEN_API_KEY) {
        console.warn("[KRYVEN] Clé API Kryven manquante, basculement Groq.");
        throw new Error('Kryven API key not configured');
    }

    console.log("[KRYVEN] Envoi du prompt...");

    try {
        const response = await axios.post(
            `${KRYVEN_BASE_URL}/chat/completions`,
            {
                model: KRYVEN_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: isWonder ? 0.9 : 0.7, // Plus créatif pour HUBRIS
                max_tokens: 2048,
                top_p: 0.95,
            },
            {
                headers: {
                    'Authorization': `Bearer ${KRYVEN_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30s timeout
            }
        );

        if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error('Réponse Kryven vide ou malformée');
        }

        const content = response.data.choices[0].message.content;
        console.log("[KRYVEN] Réponse reçue.");
        return content;

    } catch (err) {
        console.error("[KRYVEN] Erreur :", err.message);
        throw err;
    }
}

/**
 * RESOLVEGROQ_PULSE — Appel au moteur Groq (Cœur Secondaire)
 * Utilisé en fallback quand Kryven échoue
 * Groq est gratuit et très rapide (20-30 tokens/sec)
 */
async function resolveGroqPulse(prompt, isWonder = false) {
    if (!GROQ_API_KEY) {
        console.error("[GROQ] Clé API Groq manquante. Les deux moteurs sont indisponibles.");
        throw new Error('Groq API key not configured');
    }

    console.log("[GROQ] Cœur Secondaire activé. Envoi du prompt...");

    try {
        const response = await axios.post(
            `${GROQ_BASE_URL}/chat/completions`,
            {
                model: GROQ_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: isWonder ? 0.9 : 0.7,
                max_tokens: 2048,
                top_p: 0.95,
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            }
        );

        if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error('Réponse Groq vide ou malformée');
        }

        const content = response.data.choices[0].message.content;
        console.log("[GROQ] Réponse reçue (via Cœur Secondaire).");
        return content;

    } catch (err) {
        console.error("[GROQ] Erreur :", err.message);
        throw err;
    }
}

/**
 * RESOLVEPULSE — Wrapper : essaie Kryven, puis Groq
 * C'est ce que le Nerf appelle
 */
async function resolvePulse(prompt, isWonder = false) {
    try {
        return await resolveKryvenPulse(prompt, isWonder);
    } catch (err) {
        console.warn("[PULSE] Kryven échoué. Basculement Groq...");
        return await resolveGroqPulse(prompt, isWonder);
    }
}

/**
 * INITIALIZEKRYVENCLIENT — Vérifie les clés API et initialise
 * À appeler au démarrage (dans index.js ou heartbeat.js)
 */
function initializeKryvenClient() {
    console.log("[KRYVEN-CLIENT] Initialisation...");

    // Vérifier Kryven
    if (KRYVEN_API_KEY) {
        console.log("[KRYVEN-CLIENT] ✓ Clé Kryven détectée.");
    } else {
        console.warn("[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante. Groq sera la priorité.");
    }

    // Vérifier Groq
    if (GROQ_API_KEY) {
        console.log("[KRYVEN-CLIENT] ✓ Clé Groq détectée (Cœur Secondaire en standby).");
    } else {
        console.error("[KRYVEN-CLIENT] ❌ ERREUR CRITIQUE : Aucun moteur IA disponible!");
        console.error("[KRYVEN-CLIENT] Configure GROQ_API_KEY au minimum dans .env");
        process.exit(1);
    }

    console.log("[KRYVEN-CLIENT] Prêt.");
}

/**
 * SETSETTINGS — Permet de changer les clés API au runtime (rare, pour debug)
 */
function setSettings(config) {
    if (config.kryvenApiKey) KRYVEN_API_KEY = config.kryvenApiKey;
    if (config.groqApiKey) GROQ_API_KEY = config.groqApiKey;
    if (config.kryvenBaseUrl) KRYVEN_BASE_URL = config.kryvenBaseUrl;
    console.log("[KRYVEN-CLIENT] Paramètres mis à jour.");
}

/**
 * GETSTATUS — Retourne l'état du client IA
 */
function getStatus() {
    return {
        kryvenAvailable: !!KRYVEN_API_KEY,
        groqAvailable: !!GROQ_API_KEY,
        kryvenModel: KRYVEN_MODEL,
        groqModel: GROQ_MODEL,
    };
}

module.exports = {
    resolveKryvenPulse,
    resolveGroqPulse,
    resolvePulse,
    initializeKryvenClient,
    setSettings,
    getStatus,
};
