// utils/cache.js
// Système Digestif — Vésicule
// RÔLE : cache en mémoire vive pour les données consultées à
// chaque message — statut admin, liste de bannis. Évite une
// lecture MongoDB à chaque message. Voir CODEX, Système 8.
//
// Loi 1 : la Vésicule ne pense pas — elle stocke, elle restitue.

let _cache = new Map();
const DEFAULT_TTL = 60 * 1000; // 1 minute par défaut
// AVANT : la constante s'appelait "DefaultTTL" mais set()/getOrSet()
// référençaient "DEFAULT_TTL" — ReferenceError garantie au premier appel
// sans ttl explicite. Ce module n'était importé nulle part donc le bug
// était inactif, mais corrigé avant qu'il morde le jour où on le branche.

/**
 * SET — Stocke une valeur avec un TTL optionnel
 */
function set(clef, valeur, ttl = DEFAULT_TTL) {
  const expires = Date.now() + ttl;
  _cache.set(clef, { valeur, expires });
}

/**
 * GET — Récupère une valeur si elle existe et n'a pas expiré
 */
function get(clef) {
  const entry = _cache.get(clef);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    _cache.delete(clef);
    return undefined;
  }
  return entry.valeur;
}

/**
 * DELETE — Supprime une entrée
 */
function del(clef) {
  _cache.delete(clef);
}

/**
 * FLUSH — Vide tout le cache
 */
function flush() {
  _cache.clear();
}

/**
 * SIZE — Nombre d'entrées en cache
 */
function size() {
  return _cache.size;
}

/**
 * GETORSET — Retourne la valeur en cache, ou l'obtient via factory() et la stocke
 */
function getOrSet(clef, factory, ttl = DEFAULT_TTL) {
  const entry = _cache.get(clef);
  if (entry && Date.now() <= entry.expires) {
    return entry.valeur;
  }
  const valeur = factory();
  _cache.set(clef, { valeur, expires: Date.now() + ttl });
  return valeur;
}

/**
 * NOTIFYALIVE — Informe tous les consommateurs d'un changement
 */
function notifyAlive(canal) {
  const { sang } = require('../core/heartbeat');
  sang.emit('cache:invalid', { canal });
}

module.exports = { set, get, del, flush, size, getOrSet, notifyAlive };
