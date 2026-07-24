// muscle.js
// LE SYSTÈME MUSCULAIRE — Actions Concrètes
// Exécution des intentions du Nerf
// Loi 1 : Le Muscle reçoit des intentions via le Sang, jamais appels directs
// Loi 2 : Séparation stricte : Nerf décide QUOI, Muscle exécute COMMENT

const { sang } = require('./core/heartbeat');
const { getSocket } = require('./channels/whatsapp');
const { isWonder } = require('./security/recognition');

function activateMuscle() {
    console.log('[MUSCLE] Fibres activées. En attente d intentions...');
    sang.on('intention:muscle', async (payload) => {
        const { target, command, args = {}, canal, isGroup, demandedBy } = payload;
        console.log(`[MUSCLE] Intention reçue: ${command} → ${target}`);
        // "creategroup" ajouté : réservée à HUBRIS, comme les autres actions
        // qui modifient la messagerie elle-même plutôt que juste répondre.
        // Chaînes ajoutées : rejoindre/quitter sont sensibles (changent ce à quoi
        // le compte est abonné), voir/parler ne le sont pas.
        const commandesSensibles = ['block', 'unblock', 'kick', 'promote', 'demote', 'leave', 'creategroup', 'joinchannel', 'leavechannel'];
        if (commandesSensibles.includes(command.toLowerCase()) && !isWonder(demandedBy)) {
            console.warn(`[MUSCLE] Commande "${command}" refusée — ${target} n'est pas HUBRIS.`);
            sang.emit('muscle:failed', { target, command, canal, isGroup, success: false, error: 'Autorisation refusée : commande réservée à HUBRIS.' });
            return;
        }
        try {
            const result = await executeCommand(command, target, args, canal);
            sang.emit('muscle:executed', { target, command, canal, isGroup, success: true, result });
            console.log(`[MUSCLE] ${command} exécuté avec succès.`);
        } catch (err) {
            console.error(`[MUSCLE] Erreur lors de l'exécution ${command}:`, err.message);
            sang.emit('muscle:failed', { target, command, canal, isGroup, success: false, error: err.message });
        }
    });
}

async function executeCommand(command, target, args, canal) {
    const sock = getSocket();
    if (!sock) throw new Error('Client WhatsApp non disponible (canal non initialisé).');
    switch (command.toLowerCase()) {
        case 'block': return await blockUser(sock, target);
        case 'unblock': return await unblockUser(sock, target);
        case 'mute': return await muteGroup(sock, target, args.duration || 86400000);
        case 'unmute': return await unmuteGroup(sock, target);
        case 'leave': return await leaveGroup(sock, target);
        case 'join': return await joinGroup(sock, args.code);
        case 'promote': return await promoteUser(sock, target, args.groupId);
        case 'demote': return await demoteUser(sock, target, args.groupId);
        case 'kick': return await kickUser(sock, target, args.groupId);
        case 'status': return await setStatus(sock, args.text);
        case 'creategroup': return await createGroup(sock, args.subject, args.participants, target);
        case 'joinchannel': return await joinChannel(sock, args.inviteCode, args.channelJid);
        case 'leavechannel': return await leaveChannel(sock, args.channelJid);
        case 'viewchannel': return await viewChannel(sock, args.inviteCode, args.channelJid);
        case 'speakchannel': return await speakChannel(sock, args.channelJid, args.text);
        default: throw new Error(`Commande inconnue: ${command}`);
    }
}

async function blockUser(sock, userId) { await sock.updateBlockStatus(userId, 'block'); return { action: 'block', userId, status: 'blocked' }; }
async function unblockUser(sock, userId) { await sock.updateBlockStatus(userId, 'unblock'); return { action: 'unblock', userId, status: 'unblocked' }; }
async function muteGroup(sock, groupId, duration = 86400000) { sang.emit('groupe:mute', { groupId, duration, until: Date.now() + duration }); return { action: 'mute', groupId, duration, status: 'muted' }; }
async function unmuteGroup(sock, groupId) { sang.emit('groupe:unmute', { groupId }); return { action: 'unmute', groupId, status: 'unmuted' }; }
async function leaveGroup(sock, groupId) { await sock.groupLeave(groupId); return { action: 'leave', groupId, status: 'left' }; }
async function joinGroup(sock, inviteCode) { const result = await sock.groupAcceptInvite(inviteCode); return { action: 'join', inviteCode, groupId: result, status: 'joined' }; }
async function promoteUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'promote'); return { action: 'promote', userId, groupId, status: 'promoted' }; }
async function demoteUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'demote'); return { action: 'demote', userId, groupId, status: 'demoted' }; }
async function kickUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'remove'); return { action: 'kick', userId, groupId, status: 'kicked' }; }
async function setStatus(sock, statusText) { await sock.updateProfileStatus(statusText); return { action: 'status', text: statusText, status: 'updated' }; }

/**
 * CREATEGROUP — Crée un groupe WhatsApp et y ajoute des participants.
 * Si args.participants est vide/absent, ajoute automatiquement le demandeur
 * (le "target" de l'intention) — matche "crée un groupe et mets moi dedans".
 * NOTE : Baileys attend des JID au format @s.whatsapp.net pour groupCreate ;
 * si le demandeur arrive en format @lid, il faudra peut-être le convertir —
 * à vérifier au premier test réel.
 */
async function createGroup(sock, subject, participants, requester) {
    if (!subject || !subject.trim()) throw new Error('Nom de groupe manquant (args.subject).');
    const membres = (participants && participants.length) ? participants : [requester];
    const result = await sock.groupCreate(subject.trim(), membres);
    return { action: 'creategroup', subject, participants: membres, groupId: result.id, status: 'created' };
}

/**
 * Chaînes WhatsApp — API "newsletter" de Baileys.
 * NOTE : pas de méthode fiable pour promouvoir Gilgamesh admin d'une chaîne
 * par code — ce rôle se donne manuellement depuis l'app WhatsApp par HUBRIS.
 * Une fois admin, speakchannel fonctionne normalement.
 */
async function resolveChannelJid(sock, inviteCode, channelJid) {
    if (channelJid) return channelJid;
    if (!inviteCode) throw new Error('Il faut soit channelJid, soit inviteCode.');
    const meta = await sock.newsletterMetadata('invite', inviteCode);
    return meta.id;
}

async function joinChannel(sock, inviteCode, channelJid) {
    const jid = await resolveChannelJid(sock, inviteCode, channelJid);
    await sock.newsletterFollow(jid);
    return { action: 'joinchannel', channelJid: jid, status: 'followed' };
}

async function leaveChannel(sock, channelJid) {
    if (!channelJid) throw new Error('channelJid manquant.');
    await sock.newsletterUnfollow(channelJid);
    return { action: 'leavechannel', channelJid, status: 'unfollowed' };
}

async function viewChannel(sock, inviteCode, channelJid) {
    const jid = channelJid
        ? await sock.newsletterMetadata('jid', channelJid)
        : await sock.newsletterMetadata('invite', inviteCode);
    return { action: 'viewchannel', metadata: jid };
}

async function speakChannel(sock, channelJid, text) {
    if (!channelJid || !text) throw new Error('channelJid et text requis pour parler dans une chaîne.');
    await sock.sendMessage(channelJid, { text });
    return { action: 'speakchannel', channelJid, status: 'posted' };
}

module.exports = { activateMuscle, executeCommand };
