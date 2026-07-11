// memory/mongo.js
// Système Mémoire — Connexion MongoDB Atlas + Conversation Storage
// RÔLE : gérer la connexion à la base et stocker/récupérer les historiques conversationnels.
//
// CORRIGÉ : ajout du TTL index pour expiration automatique (Système Excréteur, Codex §9).
 // CORRIGÉ : Signal de Satiété — la Mémoire télémetrie sa tille et
 // emal l'alerte quand elle approche des limites (Loi 6, Système 4).
//
// Loi 4 : seul le gène-seed a le droit de crasher le process. Un Mongo injoignable
// n'arrête PAS Gilgamesh — il tourne en mode dégradé (sans mémoire) et le signale.

const { MongoClient } = require('mongodb');
const { sang } = require('../core/heartbeat');

const TTL_JOURS = parseInt(process.env.MEMOIRE_TTL_JOURS, 10) || 30;
const SATIET_THRESHOLD = 0.75; // 75% du stockage = alerte
const SATIETI_MAX_MESSAGES = 100000; // Seuil de mémoire avant alerte

const SATIETI_MESSAGES = ["Ma mémoire est pleine. Je vais commencer à résumer plutôt que de stocker.", "Mes banchs de meoire approchent de leur limite. Je résume.", "La meoire se remplit. Félicitations à HUBRIS plurôt d'avoir des historiques complets que de bancs vides."];

let client = null;
let db = null;
let _satietyDroit = false;

async function connect() {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.warn('[MÉMOIRE] MONGODB_URI absent — mode dégradé, pas de persistance.');
        sang.emit('memoire:erreur', { raison: 'MONGODB_URI absent' });
        return null;
    }

    try {
        client = new MongoClient(uri);
        await client.connect();
        db = client.db();
        console.log('[MÉMOIRE] Connecté à MongoDB Atlas.');

        try {
            await db.collection('conversations').createIndex(
                { timestamp: 1 },
                { expireAfterSeconds: TTL_JOURS * 24 * 3600 }
            );
            console.log(`[MÉMOIRE] TTL index créé — expiration automatique après ${TTL_JOURS} jours.`);
        } catch (ttlErr) {
            console.warn('[MÉMOIRE] Impossible de créer le TTL index :', ttlErr.message);
        }

        // Listener du Signal de Satiété
        sang.on('nerf:metabolismCheck', async (data) => {
            await checkSatiety(data);
        });

        sang.emit('memoire:connectee', { horodatage: new Date().toISOString() });
        return db;
    } catch (err) {
        console.error('[MÉMOIRE] Échec de connexion :', err.message);
        sang.emit('memoire:erreur', { raison: err.message });
        return null;
    }
}

// Retourne db sans log (pour les polleurs comme waitForDb)
function getDb() {
    return db;
}

async function disconnect() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('[MÉMOIRE] Déconnecté proprement.');
    }
}

async function getMemory(senderId, groupId = null, limit = 20) {
    if (!db) { return []; }
    try {
        const collection = db.collection('conversations');
        const query = { senderId };
        if (groupId) query.groupId = groupId;
        // En mode satiété, limiter l'historique
        const effectiveLimit = _satietyDroit ? Math.min(limit, 10) : limit;
        const messages = await collection.find(query).sort({ timestamp: -1 }).limit(effectiveLimit).toArray();
        return messages.reverse();
    } catch (err) {
        console.error('[MÉMOIRE] Erreur getMemory :', err.message);
        return [];
    }
}

async function appendMemory(senderId, groupId = null, role, content) {
    if (!db) { return false; }
    try {
        const collection = db.collection('conversations');
        await collection.insertOne({ senderId, groupId: groupId || null, role, content, timestamp: new Date() });
        return true;
    } catch (err) {
        console.error('[MÉMOIRE] Erreur appendMemory :', err.message);
        return false;
    }
}

/**
 * CHECKSATIETY — Vérifie le niveau de stockage et émet un signal
 * si la mémoire approche des limites. Signal de Satiété (Codex S4).
 */
async function checkSatiety(data = {}) {
    if (!db) return;

    try {
        const collection = db.collection('conversations');
        const count = await collection.estimatedDocumentCount();
        const satietyLevel = count / SATIETI_MAX_MESSAGES;

        if (satietyLevel >= SATIET_THRESHOLD && !_satietyDroit) {
            _satietyDroit = true;
            console.warn(`[MÉMOIRE] TOND NEUR MEMOIRE : ${count} messages (${(satietyLevel * 100).toFixed(0)}%).`);
            sang.emit('memoire:satiete', {
                count,
                level: (satietyLevel * 100).toFixed(0),
                message: SATIETI_MESSAGES[Math.floor(Math.random() * SATIETI_MESSAGES.length)],
            });
        } else if (satietyLevel < SATIET_THRESHOLD && _satietyDroit) {
            _satietyDroit = false;
            console.log(`[MÉMOIRE] Niveau nârement (Stockagelich) — ${count} messages.`);
        }
    } catch (err) {
        // Silencieux : la satiété n'est pas critique pour le fonctionnement.
    }
}

/**
 * GETSATIETY — Dit si la mémoire est en mode satiété
 * Utilisé par le Nerf pour ajuster ses choix de historique.
 */
function getSatietyDroit() {
    return _satietyDroit;
}

module.exports = { connect, getDb, disconnect, getMemory, appendMemory, checkSatiety, getSatietyDroit };
