// security/blocklist.js
// Extension du Système Immunitaire — blocage applicatif.
// RAISON D'ÊTRE : sur WhatsApp, block/unblock appellent sock.updateBlockStatus
// (un vrai blocage au niveau du compte). L'API Bot Telegram n'a AUCUNE méthode
// pour qu'un bot bloque un utilisateur — donc pour Telegram, le blocage est
// géré ici, en base, et vérifié par security/immune.js avant tout traitement.

import { getDb } from '../memory/mongo.js';

export async function isBlocked(senderId) {
  if (!senderId) return false;
  try {
    const db = getDb();
    if (!db) return false;
    const doc = await db.collection('blocklist').findOne({ senderId });
    return !!doc;
  } catch (err) {
    console.warn('[BLOCKLIST] Erreur lecture :', err.message);
    return false; // Fail-open : une panne DB ne doit jamais bloquer tout le monde.
  }
}

export async function block(senderId, canal) {
  const db = getDb();
  if (!db) throw new Error('MongoDB indisponible.');
  await db.collection('blocklist').updateOne(
    { senderId },
    { $set: { senderId, canal: canal || null, blockedAt: new Date() } },
    { upsert: true }
  );
  return { senderId, status: 'blocked' };
}

export async function unblock(senderId) {
  const db = getDb();
  if (!db) throw new Error('MongoDB indisponible.');
  await db.collection('blocklist').deleteOne({ senderId });
  return { senderId, status: 'unblocked' };
}
