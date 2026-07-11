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
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // ← Groq actuel (gratuit, rapide)

async function resolveKryvenPulse(prompt, isWonder = false) {
    if (!KRYVEN_API_KEY) {
        console.warn('[KRYVEN] Clé API Kryven manquante, basculement Groq.');
        throw new Error('Kryven API key not configured');
    }
    console.log('[KRYVEN] Envoi du prompt...');
    try {
        const response = await axios.post(
            `${KRYVEN_BASE_URL}/chat/completions`,
            { model: KRYVEN_MODEL, messages: [{ role: 'user', content: prompt }], temperature: isWonder ? 0.9 : 0.7, max_tokens: 2048, top_p: 0.95 },
            { headers: { 'Authorization': `Bearer ${KRYVEN_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        if (!response.data?.choices?.[0]?.message?.content) throw new Error('Réponse Kryven vide');
        console.log('[KRYVEN] Réponse reçue.');
        return response.data.choices[0].message.content;
    } catch (err) { console.error('[KRYVEN] Erreur :', err.message); throw err; }
}

async function resolveGroqPulse(prompt, isWonder = false) {
    if (!GROQ_API_KEY) { console.error('[GROQ] Clé API Groq manquante.'); throw new Error('Groq API key not configured'); }
    console.log('[GROQ] Cœur Secondaire activé. Envoi du prompt...');
    try {
        const response = await axios.post(
            `${GROQ_BASE_URL}/chat/completions`,
            { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: isWonder ? 0.9 : 0.7, max_tokens: 2048, top_p: 0.95 },
            { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        if (!response.data?.choices?.[0]?.message?.content) throw new Error('Réponse Groq vide');
        console.log('[GROQ] Réponse reçue (via Cœur Secondaire).');
        return response.data.choices[0].message.content;
    } catch (err) { console.error('[GROQ] Erreur :', err.message); throw err; }
}

async function resolvePulse(prompt, isWonder = false) {
    try { return await resolveKryvenPulse(prompt, isWonder); }
    catch (err) { console.warn('[PULSE] Kryven échoué. Basculement Groq...'); return await resolveGroqPulse(prompt, isWonder); }
}

function initializeKryvenClient() {
    console.log('[KRYVEN-CLIENT] Initialisation...');
    if (KRYVEN_API_KEY) console.log('[KRYVEN-CLIENT] ✓ Clé Kryven détectée.');
    else console.warn('[KRYVEN-CLIENT] ⚠️ Clé Kryven manquante.');
    if (GROQ_API_KEY) console.log('[KRYVEN-CLIENT] ✓ Clé Groq détectée (Cœur Secondaire).');
    else { console.error('[KRYVEN-CLIENT] ❌ Aucun moteur IA ! Configure GROQ_API_KEY dans .env'); process.exit(1); }
    console.log('[KRYVEN-CLIENT] Prêt.');
}

function setSettings(config) {
    if (config.kryvenApiKey) KRYVEN_API_KEY = config.kryvenApiKey;
    if (config.groqApiKey) GROQ_API_KEY = config.groqApiKey;
    if (config.kryvenBaseUrl) KRYVEN_BASE_URL = config.kryvenBaseUrl;
    console.log('[KRYVEN-CLIENT] Paramètres mis à jour.');
}

function getStatus() {
    return { kryvenAvailable: !!KRYVEN_API_KEY, groqAvailable: !!GROQ_API_KEY, kryvenModel: KRYVEN_MODEL, groqModel: GROQ_MODEL };
}

module.exports = { resolveKryvenPulse, resolveGroqPulse, resolvePulse, initializeKryvenClient, setSettings, getStatus };
