// utils/parser.js
// Système Digestif — Estomac
// RÔLE : reçoit le JSON brut et illisible de Baileys, en extrait UNIQUEMENT
// l'essentiel. Le Nerf ne doit JAMAIS toucher au payload brut de WhatsApp.
// Voir CODEX, Système 8.
//
// Ne sanitize rien (c'est le travail du Foie, security/filter.js) —
// extrait juste les champs propres depuis la structure Baileys.

function extraireTexte(message = {}) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

export function parseMessageBrute(msgBrut) {
  if (!msgBrut?.key || !msgBrut?.message) return null;

  // Les messages envoyés par Gilgamesh lui-même ne doivent jamais revenir dans le corps.
  if (msgBrut.key.fromMe) return null;

  const remoteJid = msgBrut.key.remoteJid || '';
  const isGroup = remoteJid.endsWith('@g.us');

  return {
    sender: isGroup ? (msgBrut.key.participant || '') : remoteJid,
    messageId: msgBrut.key.id || '',
    text: extraireTexte(msgBrut.message),
    timestamp: msgBrut.messageTimestamp || null,
    isGroup,
    nomAffiche: msgBrut.pushName || null,
  };
}
