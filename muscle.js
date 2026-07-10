// muscle.js
// LE SYSTÈME MUSCULAIRE — Actions Concrètes
// Exécution des intentions du Nerf
// Loi 1 : Le Muscle reçoit des intentions via le Sang, jamais appels directs
// Loi 2 : Séparation stricte : Nerf décide QUOI, Muscle exécute COMMENT

const { sang } = require('./core/heartbeat');
const { getSocket } = require('./channels/whatsapp');
const { isWonder } = require('./recognition');

function activateMuscle() {
    console.log('[MUSCLE] Fibres activées. En attente d''intentions...');
    sang.on('intention:muscle', async (payload) => {
        const { target, command, args = {}, canal, demandedBy } = payload;
        console.log(`[MUSCLE] Intention reçue: ${command} → ${target}`);
        const commandesSensibles = ['block', 'unblock', 'kick', 'promote', 'demote', 'leave'];
        if (commandesSensibles.includes(command.toLowerCase()) && !isWonder(demandedBy)) {
            console.warn(`[MUSCLE] Commande "${command}" refusée — ${target} n''est pas HUBRIS.`);
            sang.emit('muscle:failed', { target, command, success: false, error: 'Autorisation refusée : commande réservée à HUBRIS.' });
            return;
        }
        try {
            const result = await executeCommand(command, target, args, canal);
            sang.emit('muscle:executed', { target, command, success: true, result });
            console.log(`[MUSCLE] ${command} exécuté avec succès.`);
        } catch (err) {
            console.error(`[MUSCLE] Erreur lors de l''exécution ${command}:`, err.message);
            sang.emit('muscle:failed', { target, command, success: false, error: err.message });
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

module.exports = { activateMuscle, executeCommand };
