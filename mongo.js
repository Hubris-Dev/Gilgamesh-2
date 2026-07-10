// memory/mongo.js
// Système Mémoire — Connexion MongoDB Atlas
// RÔLE : gérer la connexion à la base. Ne définit AUCUN schéma, AUCUNE collection
// métier — ça viendra avec Nerf/Canaux, une fois qu'on saura ce qu'il faut stocker.
// Pour l'instant : se connecter, rester connecté, le signaler au corps via le Sang.
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

module.exports = { connect, getDb, disconnect };
 
