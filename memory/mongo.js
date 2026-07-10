// memory/mongo.js
// Système Mémoire — Connexion MongoDB Atlas + Conversation Storage
// RÔLE : gérer la connexion à la base et stocker/récupérer les historiques conversationnels.
//
// Loi 4 : seul le gène-seed a le droit de crasher le process. Un Mongo injoignable
// n'arrête PAS Gilgamesh — il tourne en mode dégradé (sans mémoire) et le signale.
//
// Le nom de la base est attendu DANS l'URI (ex: .../gilgamesh?retryWrites=true).

const { MongoClient } = require('mongodb');
const { sang } = require('../heartbeat');

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
    sang.emit('memoire:connectee', { horodatage: new Date().toISOString() });
    return db;
  } catch (err) {
    console.error('[MÉMOIRE] Échec de connexion :', err.message);
    sang.emit('memoire:erreur', { raison: err.message });
    return null;
  }
}

function getDb() {
  if (!db) {
    console.warn('[MÉMOIRE] getDb() appelé avant connexion réussie — retourne null.');
  }
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

/**
 * GETMEMORY — Récupère l'historique conversationnel
 * @param {string} senderId - ID de l'utilisateur
 * @param {string|null} groupId - ID du groupe (null pour DM)
 * @param {number} limit - Nombre de messages à récupérer
 * @returns {Array} Historique chronologique (ancien → récent)
 */
async function getMemory(senderId, groupId = null, limit = 20) {
  if (!db) {
    console.warn('[MÉMOIRE] DB indisponible');
    return [];
  }

  try {
    const collection = db.collection('conversations');
    const query = { senderId };
    if (groupId) query.groupId = groupId;

    const messages = await collection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    // Retourner dans l'ordre chronologique (ancien → récent)
    return messages.reverse();
  } catch (err) {
    console.error('[MÉMOIRE] Erreur getMemory :', err.message);
    return [];
  }
}

/**
 * APPENDMEMORY — Ajoute un message à l'historique
 * @param {string} senderId - ID de l'utilisateur
 * @param {string|null} groupId - ID du groupe (null pour DM)
 * @param {string} role - 'user' ou 'assistant'
 * @param {string} content - Contenu du message
 * @returns {boolean} True si succès, false sinon
 */
async function appendMemory(senderId, groupId = null, role, content) {
  if (!db) {
    console.warn('[MÉMOIRE] DB indisponible, impossible de sauvegarder');
    return false;
  }

  try {
    const collection = db.collection('conversations');
    await collection.insertOne({
      senderId,
      groupId: groupId || null,
      role, // 'user' ou 'assistant'
      content,
      timestamp: new Date(),
    });
    return true;
  } catch (err) {
    console.error('[MÉMOIRE] Erreur appendMemory :', err.message);
    return false;
  }
}

module.exports = { connect, getDb, disconnect, getMemory, appendMemory };
