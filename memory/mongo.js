// memory/mongo.js
// Système Mémoire — Connexion MongoDB Atlas + Conversation Storage
// RÔLE : gérer la connexion à la base et stocker/récupérer les historiques conversationnels.
//
// CORRIGÉ : ajout du TTL index pour expiration automatique (Système Excréteur, Codex §9).
//
// Loi 4 : seul le gène-seed a le droit de crasher le process. Un Mongo injoignable
// n'arrête PAS Gilgamesh — il tourne en mode dégradé (sans mémoire) et le signale.

const { MongoClient } = require('mongodb');
const { sang } = require('../core/heartbeat');

const TTL_JOURS = parseInt(process.env.MEMOIRE_TTL_JOURS, 10) || 30;

let client = null;
let db = null;

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
    if (!db) { console.warn('[MÉMOIRE] DB indisponible'); return []; }
    try {
        const collection = db.collection('conversations');
        const query = { senderId };
        if (groupId) query.groupId = groupId;
        const messages = await collection.find(query).sort({ timestamp: -1 }).limit(limit).toArray();
        return messages.reverse();
    } catch (err) {
        console.error('[MÉMOIRE] Erreur getMemory :', err.message);
        return [];
    }
}

async function appendMemory(senderId, groupId = null, role, content) {
    if (!db) { console.warn('[MÉMOIRE] DB indisponible'); return false; }
    try {
        const collection = db.collection('conversations');
        await collection.insertOne({ senderId, groupId: groupId || null, role, content, timestamp: new Date() });
        return true;
    } catch (err) {
        console.error('[MÉMOIRE] Erreur appendMemory :', err.message);
        return false;
    }
}

module.exports = { connect, getDb, disconnect, getMemory, appendMemory };
