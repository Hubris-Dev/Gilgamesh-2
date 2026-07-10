// muscle.js
// LE SYSTÈME MUSCULAIRE — Actions Concrètes
// Exécution des intentions du Nerf
// Loi 1 : Le Muscle reçoit des intentions via le Sang, jamais appels directs
// Loi 2 : Séparation stricte : Nerf décide QUOI, Muscle exécute COMMENT

const { sang } = require('./core/heartbeat');
const { getWAClient } = require('./channels/whatsapp');

/**
 * ACTIVATEMUSCLE — Point d'entrée du Système Musculaire
 * Écoute les intentions émises par le Nerf et les exécute
 */
function activateMuscle() {
    console.log("[MUSCLE] Fibres activées. En attente d'intentions...");

    // Le Muscle reçoit les intentions du Nerf via le Sang
    sang.on('intention:muscle', async (payload) => {
        const { target, command, args = {}, canal } = payload;

        console.log(`[MUSCLE] Intention reçue: ${command} → ${target}`);

        try {
            const result = await executeCommand(command, target, args, canal);
            
            // Signaler le succès au Sang
            sang.emit('muscle:executed', {
                target,
                command,
                success: true,
                result,
            });

            console.log(`[MUSCLE] ${command} exécuté avec succès.`);

        } catch (err) {
            console.error(`[MUSCLE] Erreur lors de l'exécution ${command}:`, err.message);
            
            // Signaler l'échec au Sang (le Nerf ou le Cœur peut réagir)
            sang.emit('muscle:failed', {
                target,
                command,
                success: false,
                error: err.message,
            });
        }
    });
}

/**
 * EXECUTECOMMAND — Routeur d'exécution
 * Distribue vers la bonne fonction en fonction de la commande
 */
async function executeCommand(command, target, args, canal) {
    const waClient = getWAClient();

    if (!waClient) {
        throw new Error('Client WhatsApp non disponible (canal non initialisé).');
    }

    switch (command.toLowerCase()) {
        case 'block':
            return await blockUser(waClient, target);

        case 'unblock':
            return await unblockUser(waClient, target);

        case 'mute':
            return await muteGroup(waClient, target, args.duration || 86400000); // 24h par défaut

        case 'unmute':
            return await unmuteGroup(waClient, target);

        case 'leave':
            return await leaveGroup(waClient, target);

        case 'join':
            return await joinGroup(waClient, args.code);

        case 'promote':
            return await promoteUser(waClient, target, args.groupId);

        case 'demote':
            return await demoteUser(waClient, target, args.groupId);

        case 'kick':
            return await kickUser(waClient, target, args.groupId);

        case 'status':
            return await setStatus(waClient, args.text);

        default:
            throw new Error(`Commande inconnue: ${command}`);
    }
}

/**
 * BLOCKUSER — Bloquer un utilisateur
 */
async function blockUser(waClient, userId) {
    console.log(`[MUSCLE:BLOCK] Blocage de ${userId}...`);

    try {
        await waClient.updateBlockStatus(userId, 'block');
        console.log(`[MUSCLE:BLOCK] ${userId} bloqué avec succès.`);
        return { action: 'block', userId, status: 'blocked' };
    } catch (err) {
        console.error(`[MUSCLE:BLOCK] Erreur :`,.message);
        throw err;
    }
}

/**
 * UNBLOCKUSER — Débloquer un utilisateur
 */
async function unblockUser(waClient, userId) {
    console.log(`[MUSCLE:UNBLOCK] Déblocage de ${userId}...`);

    try {
        await waClient.updateBlockStatus(userId, 'unblock');
        console.log(`[MUSCLE:UNBLOCK] ${userId} débloqué avec succès.`);
        return { action: 'unblock', userId, status: 'unblocked' };
    } catch (err) {
        console.error(`[MUSCLE:UNBLOCK] Erreur :`, err.message);
        throw err;
    }
}

/**
 * MUTEGROUP — Mute un groupe (désactiver les notifications pour le Nerf)
 * Duration en ms (par défaut 24h)
 */
async function muteGroup(waClient, groupId, duration = 86400000) {
    console.log(`[MUSCLE:MUTE] Mute du groupe ${groupId} pour ${duration}ms...`);

    try {
        // Baileys n'a pas d'API native pour mute, mais on peut utiliser updateChatSetting
        // Alternative : filtrer les messages du groupe au niveau du Nerf (memory/mongo.js)
        // Pour l'instant, on signale l'intention au Sang, qui peut la traiter au niveau du Nerf

        console.log(`[MUSCLE:MUTE] Groupe ${groupId} marqué comme muet (via memory).`);
        
        // Émettre un signal pour que la mémoire ignore ce groupe
        sang.emit('mute:group', {
            groupId,
            duration,
            until: Date.now() + duration,
        });

        return { action: 'mute', groupId, duration, status: 'muted' };
    } catch (err) {
        console.error(`[MUSCLE:MUTE] Erreur :`, err.message);
        throw err;
    }
}

/**
 * UNMUTEGROUP — Unmute un groupe
 */
async function unmuteGroup(waClient, groupId) {
    console.log(`[MUSCLE:UNMUTE] Unmute du groupe ${groupId}...`);

    try {
        sang.emit('unmute:group', { groupId });
        console.log(`[MUSCLE:UNMUTE] Groupe ${groupId} réactivé.`);
        return { action: 'unmute', groupId, status: 'unmuted' };
    } catch (err) {
        console.error(`[MUSCLE:UNMUTE] Erreur :`, err.message);
        throw err;
    }
}

/**
 * LEAVEGROUP — Quitter un groupe
 */
async function leaveGroup(waClient, groupId) {
    console.log(`[MUSCLE:LEAVE] Quitter le groupe ${groupId}...`);

    try {
        await waClient.groupLeave(groupId);
        console.log(`[MUSCLE:LEAVE] Groupe ${groupId} quitté avec succès.`);
        return { action: 'leave', groupId, status: 'left' };
    } catch (err) {
        console.error(`[MUSCLE:LEAVE] Erreur :`, err.message);
        throw err;
    }
}

/**
 * JOINGROUP — Rejoindre un groupe via code d'invitation
 */
async function joinGroup(waClient, inviteCode) {
    console.log(`[MUSCLE:JOIN] Rejoindre le groupe avec code ${inviteCode}...`);

    try {
        const result = await waClient.groupAcceptInvite(inviteCode);
        console.log(`[MUSCLE:JOIN] Groupe rejoint avec succès. ID: ${result}`);
        return { action: 'join', inviteCode, groupId: result, status: 'joined' };
    } catch (err) {
        console.error(`[MUSCLE:JOIN] Erreur :`, err.message);
        throw err;
    }
}

/**
 * PROMOTEUSER — Promouvoir un utilisateur en admin d'un groupe
 */
async function promoteUser(waClient, userId, groupId) {
    console.log(`[MUSCLE:PROMOTE] Promotion de ${userId} dans ${groupId}...`);

    try {
        await waClient.groupParticipantsUpdate(
            groupId,
            [userId],
            'promote'
        );
        console.log(`[MUSCLE:PROMOTE] ${userId} promu avec succès.`);
        return { action: 'promote', userId, groupId, status: 'promoted' };
    } catch (err) {
        console.error(`[MUSCLE:PROMOTE] Erreur :`, err.message);
        throw err;
    }
}

/**
 * DEMOTEUSER — Rétrograder un utilisateur (enlever admin)
 */
async function demoteUser(waClient, userId, groupId) {
    console.log(`[MUSCLE:DEMOTE] Rétrogradation de ${userId} dans ${groupId}...`);

    try {
        await waClient.groupParticipantsUpdate(
            groupId,
            [userId],
            'demote'
        );
        console.log(`[MUSCLE:DEMOTE] ${userId} rétrogradé avec succès.`);
        return { action: 'demote', userId, groupId, status: 'demoted' };
    } catch (err) {
        console.error(`[MUSCLE:DEMOTE] Erreur :`, err.message);
        throw err;
    }
}

/**
 * KICKUSER — Expulser un utilisateur d'un groupe
 */
async function kickUser(waClient, userId, groupId) {
    console.log(`[MUSCLE:KICK] Expulsion de ${userId} du groupe ${groupId}...`);

    try {
        await waClient.groupParticipantsUpdate(
            groupId,
            [userId],
            'remove'
        );
        console.log(`[MUSCLE:KICK] ${userId} expulsé avec succès.`);
        return { action: 'kick', userId, groupId, status: 'kicked' };
    } catch (err) {
        console.error(`[MUSCLE:KICK] Erreur :`, err.message);
        throw err;
    }
}

/**
 * SETSTATUS — Changer le statut (bio) de Gilgamesh
 */
async function setStatus(waClient, statusText) {
    console.log(`[MUSCLE:STATUS] Changement de statut: "${statusText}"`);

    try {
        await waClient.updateProfileStatus(statusText);
        console.log(`[MUSCLE:STATUS] Statut mis à jour.`);
        return { action: 'status', text: statusText, status: 'updated' };
    } catch (err) {
        console.error(`[MUSCLE:STATUS] Erreur :`, err.message);
        throw err;
    }
}

module.exports = { activateMuscle, executeCommand };
