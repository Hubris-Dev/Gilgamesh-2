// muscle.js
// LE SYSTÈME MUSCULAIRE — Actions Concrètes
// Exécution des intentions du Nerf
// Loi 1 : Le Muscle reçoit des intentions via le Sang, jamais appels directs
// Loi 2 : Séparation stricte : Nerf décide QUOI, Muscle exécute COMMENT
//
// FIX 08/07 : joinGroup force une synchro metadata après avoir rejoint

import axios from 'axios';
import { sang } from './core/heartbeat.js';
import { getSocket } from './channels/whatsapp.js';
import { telegramApi } from './channels/telegram.js';
import { isWonder } from './security/recognition.js';
import * as blocklist from './security/blocklist.js';

export function activateMuscle() {
    console.log('[MUSCLE] Fibres activées. En attente d intentions...');
    sang.on('intention:muscle', async (payload) => {
        const { target, command, args = {}, canal, isGroup, groupId, demandedBy } = payload;
        console.log(`[MUSCLE] Intention reçue: ${command} → ${target}`);
        
        const commandesSensibles = ['block', 'unblock', 'kick', 'promote', 'demote', 'leave', 'creategroup', 'joinchannel', 'leavechannel'];
        if (commandesSensibles.includes(command.toLowerCase()) && !isWonder(demandedBy)) {
            console.warn(`[MUSCLE] Commande "${command}" refusée — ${target} n'est pas HUBRIS.`);
            sang.emit('muscle:failed', { target, command, canal, isGroup, groupId, success: false, error: 'Autorisation refusée : commande réservée à HUBRIS.' });
            return;
        }
        try {
            const result = await executeCommand(command, target, args, canal, isGroup, groupId);
            sang.emit('muscle:executed', { target, command, canal, isGroup, groupId, success: true, result });
            console.log(`[MUSCLE] ${command} exécuté avec succès.`);
        } catch (err) {
            console.error(`[MUSCLE] Erreur lors de l'exécution ${command}:`, err.message);
            sang.emit('muscle:failed', { target, command, canal, isGroup, groupId, success: false, error: err.message });
        }
    });
}

export async function executeCommand(command, target, args, canal, isGroup, groupId) {
    const cmd = command.toLowerCase();

    // Canal-agnostique — ne touche ni WhatsApp ni Telegram, pas besoin de dispatch.
    if (cmd === 'websearch') return await webSearch(args.query);

    if (canal === 'telegram') {
        return await executeCommandTelegram(cmd, target, args, isGroup, groupId);
    }
    return await executeCommandWhatsApp(cmd, target, args, canal, isGroup, groupId);
}

async function executeCommandWhatsApp(command, target, args, canal, isGroup, groupId) {
    const sock = getSocket();
    if (!sock) throw new Error('Client WhatsApp non disponible (canal non initialisé).');
    switch (command) {
        case 'block': return await blockUser(sock, args.userId || target);
        case 'unblock': return await unblockUser(sock, args.userId || target);
        case 'mute':
            if (!isGroup || !groupId) throw new Error('mute nécessite un contexte de groupe.');
            return await muteGroup(groupId, args.duration || 86400000);
        case 'unmute':
            if (!isGroup || !groupId) throw new Error('unmute nécessite un contexte de groupe.');
            return await unmuteGroup(groupId);
        case 'leave':
            if (!isGroup || !groupId) throw new Error('leave nécessite un contexte de groupe.');
            return await leaveGroup(sock, groupId);
        case 'join': return await joinGroup(sock, args.code || args.inviteCode);
        case 'promote': return await promoteUser(sock, args.userId || target, args.groupId || groupId);
        case 'demote': return await demoteUser(sock, args.userId || target, args.groupId || groupId);
        case 'kick': return await kickUser(sock, args.userId || target, args.groupId || groupId);
        case 'status': return await setStatus(sock, args.text);
        case 'creategroup': return await createGroup(sock, args.subject, args.participants, target);
        case 'joinchannel': return await joinChannel(sock, args.inviteCode, args.channelJid);
        case 'leavechannel': return await leaveChannel(sock, args.channelJid);
        case 'viewchannel': return await viewChannel(sock, args.inviteCode, args.channelJid);
        case 'speakchannel': return await speakChannel(sock, args.channelJid, args.text);
        default: throw new Error(`Commande inconnue: ${command}`);
    }
}

/**
 * EXECUTECOMMANDTELEGRAM — miroir de executeCommandWhatsApp.
 * "join", "creategroup", "joinchannel" n'ont AUCUN équivalent Bot API —
 * ce n'est pas un manque de code, c'est une limite de la plateforme
 * (un bot ne peut ni créer ni rejoindre un groupe/chaîne de lui-même,
 * seul un humain peut l'y ajouter). On le dit clairement plutôt que
 * de faire semblant que ça marche.
 */
async function executeCommandTelegram(command, target, args, isGroup, groupId) {
    switch (command) {
        case 'block': return await blocklist.block(args.userId || target, 'telegram');
        case 'unblock': return await blocklist.unblock(args.userId || target);
        case 'mute':
            if (!isGroup || !groupId) throw new Error('mute nécessite un contexte de groupe.');
            return await muteGroup(groupId, args.duration || 86400000);
        case 'unmute':
            if (!isGroup || !groupId) throw new Error('unmute nécessite un contexte de groupe.');
            return await unmuteGroup(groupId);
        case 'leave':
            if (!isGroup || !groupId) throw new Error('leave nécessite un contexte de groupe.');
            return await leaveChatTelegram(groupId);
        case 'join':
        case 'creategroup':
        case 'joinchannel':
            throw new Error(`"${command}" n'est pas possible sur Telegram : aucune méthode Bot API ne permet à un bot de créer ou rejoindre un groupe/chaîne de lui-même. Il faut qu'un humain l'y ajoute manuellement.`);
        case 'promote': return await promoteUserTelegram(args.userId, args.groupId || groupId, true);
        case 'demote': return await promoteUserTelegram(args.userId, args.groupId || groupId, false);
        case 'kick': return await kickUserTelegram(args.userId, args.groupId || groupId);
        case 'status': return await setStatusTelegram(args.text);
        case 'leavechannel': return await leaveChatTelegram(args.channelJid || groupId);
        case 'viewchannel': return await viewChannelTelegram(args.channelJid || groupId);
        case 'speakchannel': return await speakChannelTelegram(args.channelJid, args.text);
        default: throw new Error(`Commande inconnue: ${command}`);
    }
}

async function blockUser(sock, userId) { await sock.updateBlockStatus(userId, 'block'); return { action: 'block', userId, status: 'blocked' }; }
async function unblockUser(sock, userId) { await sock.updateBlockStatus(userId, 'unblock'); return { action: 'unblock', userId, status: 'unblocked' }; }
async function muteGroup(groupId, duration = 86400000) { sang.emit('groupe:mute', { groupId, duration, until: Date.now() + duration }); return { action: 'mute', groupId, duration, status: 'muted' }; }
async function unmuteGroup(groupId) { sang.emit('groupe:unmute', { groupId }); return { action: 'unmute', groupId, status: 'unmuted' }; }
async function leaveGroup(sock, groupId) { await sock.groupLeave(groupId); return { action: 'leave', groupId, status: 'left' }; }

/**
 * JOINGROUP — FIX 08/07 : force une synchro des métadonnées après avoir rejoint.
 * Résout le "not-acceptable" qui peut survenir quand les clés de chiffrement
 * du groupe ne sont pas encore chargées côté client.
 */
async function joinGroup(sock, inviteCode) {
    if (!inviteCode) throw new Error('Code d\'invitation manquant (args.code ou args.inviteCode).');
    console.log(`[MUSCLE] Rejoindre le groupe avec le code: ${inviteCode}`);
    
    const result = await sock.groupAcceptInvite(inviteCode);
    const groupId = typeof result === 'string' ? result : result?.id || result?.gid;
    console.log(`[MUSCLE] Groupe rejoint: ${groupId}`);
    
    // FIX : forcer une synchro des métadonnées du groupe
    // pour que les clés de chiffrement soient chargées
    if (groupId) {
        try {
            await sock.groupMetadata(groupId);
            console.log(`[MUSCLE] Métadonnées du groupe ${groupId} synchronisées.`);
        } catch (metaErr) {
            console.warn(`[MUSCLE] Synchro metadata échouée pour ${groupId}: ${metaErr.message} — l'envoi pourrait échouer.`);
            sang.emit('muscle:erreur', { niveau: 'warn', raison: 'sync_metadata_groupe_echouee', groupId, detail: metaErr.message });
        }
    }
    
    return { action: 'join', inviteCode, groupId, status: 'joined' };
}

async function promoteUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'promote'); return { action: 'promote', userId, groupId, status: 'promoted' }; }
async function demoteUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'demote'); return { action: 'demote', userId, groupId, status: 'demoted' }; }
async function kickUser(sock, userId, groupId) { await sock.groupParticipantsUpdate(groupId, [userId], 'remove'); return { action: 'kick', userId, groupId, status: 'kicked' }; }
async function setStatus(sock, statusText) { await sock.updateProfileStatus(statusText); return { action: 'status', text: statusText, status: 'updated' }; }

async function createGroup(sock, subject, participants, requester) {
    if (!subject || !subject.trim()) throw new Error('Nom de groupe manquant (args.subject).');
    const membres = (participants && participants.length) ? participants : [requester];
    const result = await sock.groupCreate(subject.trim(), membres);
    return { action: 'creategroup', subject, participants: membres, groupId: result.id, status: 'created' };
}

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

// ═══════════════════════════════════════════════════════════════
// TELEGRAM — implémentations réelles (Bot API vérifiée, aucune
// méthode inventée). Voir executeCommandTelegram plus haut pour
// ce qui N'A PAS d'équivalent (join/creategroup/joinchannel).
// ═══════════════════════════════════════════════════════════════

async function leaveChatTelegram(chatId) {
    if (!chatId) throw new Error('chatId (groupe/chaîne) manquant pour leave.');
    await telegramApi('leaveChat', { chat_id: chatId });
    return { action: 'leave', chatId, status: 'left' };
}

async function promoteUserTelegram(userId, chatId, elever) {
    if (!userId) throw new Error('userId manquant — réponds au message de la personne visée pour que je sache qui cibler.');
    if (!chatId) throw new Error('chatId (groupe) manquant.');
    await telegramApi('promoteChatMember', {
        chat_id: chatId,
        user_id: Number(userId),
        can_manage_chat: elever,
        can_delete_messages: elever,
        can_manage_video_chats: elever,
        can_restrict_members: elever,
        can_promote_members: elever,
        can_change_info: elever,
        can_invite_users: elever,
        can_pin_messages: elever,
    });
    return { action: elever ? 'promote' : 'demote', userId, chatId, status: elever ? 'promoted' : 'demoted' };
}

/**
 * KICKUSERTELEGRAM — ban puis unban immédiat.
 * C'est le pattern standard pour un "kick" doux sur Telegram : banChatMember
 * seul est un ban PERMANENT (empêche de revenir même via invitation). Pour
 * matcher le comportement WhatsApp (juste retiré, peut revenir), on lève
 * le ban tout de suite après — équivalent honnête, pas une approximation.
 */
async function kickUserTelegram(userId, chatId) {
    if (!userId) throw new Error('userId manquant — réponds au message de la personne visée pour que je sache qui cibler.');
    if (!chatId) throw new Error('chatId (groupe) manquant.');
    await telegramApi('banChatMember', { chat_id: chatId, user_id: Number(userId) });
    await telegramApi('unbanChatMember', { chat_id: chatId, user_id: Number(userId), only_if_banned: true });
    return { action: 'kick', userId, chatId, status: 'kicked' };
}

async function setStatusTelegram(text) {
    if (!text) throw new Error('text manquant pour status.');
    await telegramApi('setMyDescription', { description: text.substring(0, 512) });
    return { action: 'status', text, status: 'updated' };
}

async function viewChannelTelegram(chatId) {
    if (!chatId) throw new Error('chatId manquant pour viewchannel.');
    const info = await telegramApi('getChat', { chat_id: chatId });
    let memberCount = null;
    try { memberCount = await telegramApi('getChatMemberCount', { chat_id: chatId }); } catch (_) { /* pas bloquant */ }
    return { action: 'viewchannel', metadata: { title: info.title, description: info.description || null, memberCount } };
}

async function speakChannelTelegram(chatId, text) {
    if (!chatId || !text) throw new Error('channelJid et text requis pour parler dans une chaîne.');
    await telegramApi('sendMessage', { chat_id: chatId, text });
    return { action: 'speakchannel', chatId, status: 'posted' };
}

// ═══════════════════════════════════════════════════════════════
// WEBSEARCH — canal-agnostique. Provider configurable via env
// (SEARCH_API_KEY). Défaut : Brave Search API (clé simple, un seul
// header). Vérifie les conditions/tarifs actuels avant de compter
// dessus en prod — ça change souvent, on ne les invente pas ici.
// ═══════════════════════════════════════════════════════════════

async function webSearch(query) {
    if (!query || !query.trim()) throw new Error('query manquante pour websearch.');
    const apiKey = process.env.SEARCH_API_KEY;
    if (!apiKey) throw new Error('SEARCH_API_KEY non configurée — recherche web indisponible.');

    try {
        const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: { q: query, count: 5 },
            headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
            timeout: 10000,
        });

        const resultats = (data.web?.results || []).slice(0, 5).map(r => ({
            titre: r.title,
            extrait: (r.description || '').replace(/<\/?[^>]+(>|$)/g, '').substring(0, 150),
            url: r.url,
        }));

        return { action: 'websearch', query, resultats };
    } catch (err) {
        const desc = err.response?.data?.message || err.message;
        throw new Error(`Recherche web échouée : ${desc}`);
    }
}
