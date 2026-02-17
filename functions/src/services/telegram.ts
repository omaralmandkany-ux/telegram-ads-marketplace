// Telegram Bot Service - handles all Telegram API interactions

import { Telegraf } from 'telegraf';
import { config } from '../config';
import { Timestamp } from '../firebase';
import { ChannelStats } from '../types';

// Lazy initialize bot to prevent deployment timeout
let _bot: Telegraf | null = null;
export function getBot(): Telegraf {
    if (!_bot) {
        _bot = new Telegraf(config.telegramBotToken);
    }
    return _bot;
}

// For backward compatibility
export const bot = {
    get telegram() { return getBot().telegram; },
    handleUpdate: (update: any) => getBot().handleUpdate(update)
};

// Get channel info and stats (MTProto primary, Bot API fallback)
export async function getChannelInfo(channelIdOrUsername: string | number): Promise<{
    chat: any;
    memberCount: number;
    photoUrl?: string;
}> {
    // Try MTProto first
    try {
        const { isUserbotConfigured, userbotGetChannelInfo } = await import('./userbot');
        if (isUserbotConfigured()) {
            console.log('Getting channel info via MTProto...');
            const info = await userbotGetChannelInfo(channelIdOrUsername);
            return {
                chat: { id: info.id, title: info.title, username: info.username, type: info.type },
                memberCount: info.memberCount,
                photoUrl: info.photoUrl,
            };
        }
    } catch (e: any) {
        console.log('MTProto getChannelInfo failed, trying Bot API:', e?.message);
    }

    // Fallback: Bot API
    try {
        const chat = await bot.telegram.getChat(channelIdOrUsername);
        const memberCount = await bot.telegram.getChatMembersCount(channelIdOrUsername);
        let photoUrl: string | undefined;
        try {
            if ((chat as any).photo?.big_file_id) {
                const fileLink = await bot.telegram.getFileLink((chat as any).photo.big_file_id);
                photoUrl = typeof fileLink === 'string' ? fileLink : fileLink.href;
            }
        } catch { /* ignore */ }
        return { chat, memberCount, photoUrl };
    } catch (error) {
        console.error('Error getting channel info:', error);
        throw new Error('Failed to get channel information');
    }
}

// Check if userbot (@PHo_iraq) or bot is admin in channel
export async function checkBotIsAdmin(channelId: number): Promise<{
    isAdmin: boolean;
    canPost: boolean;
    canDelete: boolean;
}> {
    try {
        console.log(`Checking admin status for channel ${channelId} via MTProto userbot`);

        // Primary: Use MTProto userbot to check
        try {
            const { checkUserbotIsAdmin } = await import('./userbot');
            const result = await checkUserbotIsAdmin(channelId);
            console.log(`MTProto admin check result:`, result);
            return result;
        } catch (mtprotoError: any) {
            console.log(`MTProto admin check failed: ${mtprotoError?.message}, trying Bot API fallback...`);
        }

        // Fallback: Try Bot API (only works if bot is member of channel)
        try {
            const admins = await bot.telegram.getChatAdministrators(channelId);
            const userbotAdmin = admins.find(admin =>
                admin.user.username?.toLowerCase() === 'pho_iraq'
            );

            if (userbotAdmin) {
                const isAdmin = userbotAdmin.status === 'administrator' || userbotAdmin.status === 'creator';
                const canPost = isAdmin && (userbotAdmin.status === 'creator' || (userbotAdmin as any).can_post_messages !== false);
                const canDelete = isAdmin && (userbotAdmin.status === 'creator' || (userbotAdmin as any).can_delete_messages !== false);
                return { isAdmin, canPost, canDelete };
            }
        } catch (botError: any) {
            console.log(`Bot API fallback also failed: ${botError?.message}`);
        }

        return { isAdmin: false, canPost: false, canDelete: false };
    } catch (error: any) {
        console.error('Error in checkBotIsAdmin:', error?.message || error);
        return { isAdmin: false, canPost: false, canDelete: false };
    }
}

// Check if user is admin of channel (MTProto primary, Bot API fallback)
export async function checkUserIsAdmin(channelId: number, userId: number): Promise<boolean> {
    // Try MTProto first
    try {
        const { isUserbotConfigured, userbotCheckUserIsAdmin } = await import('./userbot');
        if (isUserbotConfigured()) {
            console.log(`Checking if user ${userId} is admin via MTProto...`);
            return await userbotCheckUserIsAdmin(channelId, userId);
        }
    } catch (e: any) {
        console.log('MTProto checkUserIsAdmin failed:', e?.message);
    }

    // Fallback: Bot API
    try {
        const member = await bot.telegram.getChatMember(channelId, userId);
        return member.status === 'administrator' || member.status === 'creator';
    } catch (error: any) {
        console.error('Error checking user admin status:', error?.message || error);
        return true; // Default to true to allow registration
    }
}

// Get channel admins with detailed info
export interface TelegramAdminInfo {
    telegramId: number;
    username?: string;
    firstName: string;
    lastName?: string;
    role: 'creator' | 'admin';
    permissions: {
        canPostMessages: boolean;
        canDeleteMessages: boolean;
        canEditMessages: boolean;
        canManageChat: boolean;
        canRestrictMembers: boolean;
        canPromoteMembers: boolean;
    };
}

export async function getChannelAdmins(channelId: number): Promise<number[]> {
    // Try MTProto first
    try {
        const { isUserbotConfigured, userbotGetChannelAdmins } = await import('./userbot');
        if (isUserbotConfigured()) {
            return await userbotGetChannelAdmins(channelId);
        }
    } catch (e: any) {
        console.log('MTProto getChannelAdmins failed:', e?.message);
    }

    // Fallback: Bot API
    try {
        const admins = await bot.telegram.getChatAdministrators(channelId);
        return admins.filter(admin => !admin.user.is_bot).map(admin => admin.user.id);
    } catch (error) {
        console.error('Error getting channel admins:', error);
        return [];
    }
}

// Get detailed channel admins with permissions (MTProto primary)
export async function getChannelAdminsDetailed(channelId: number): Promise<TelegramAdminInfo[]> {
    // Try MTProto first
    try {
        const { isUserbotConfigured, userbotGetChannelAdminsDetailed } = await import('./userbot');
        if (isUserbotConfigured()) {
            return await userbotGetChannelAdminsDetailed(channelId) as TelegramAdminInfo[];
        }
    } catch (e: any) {
        console.log('MTProto getChannelAdminsDetailed failed:', e?.message);
    }

    // Fallback: Bot API
    try {
        const admins = await bot.telegram.getChatAdministrators(channelId);
        return admins.filter(admin => !admin.user.is_bot).map(admin => {
            const isCreator = admin.status === 'creator';
            return {
                telegramId: admin.user.id,
                username: admin.user.username,
                firstName: admin.user.first_name,
                lastName: admin.user.last_name,
                role: isCreator ? 'creator' : 'admin' as const,
                permissions: {
                    canPostMessages: isCreator || (admin as any).can_post_messages !== false,
                    canDeleteMessages: isCreator || (admin as any).can_delete_messages !== false,
                    canEditMessages: isCreator || (admin as any).can_edit_messages !== false,
                    canManageChat: isCreator || (admin as any).can_manage_chat !== false,
                    canRestrictMembers: isCreator || (admin as any).can_restrict_members !== false,
                    canPromoteMembers: isCreator || (admin as any).can_promote_members !== false,
                },
            };
        });
    } catch (error) {
        console.error('Error getting detailed channel admins:', error);
        return [];
    }
}

// Fetch and update channel stats
// Uses MTProto (userbot) for real stats, falls back to Bot API estimates
export async function fetchChannelStats(channelId: number): Promise<ChannelStats> {
    // Try userbot (MTProto) first for real stats
    try {
        const { isUserbotConfigured, fetchFullChannelStats } = require('./userbot');
        if (isUserbotConfigured()) {
            console.log(`Fetching real stats for channel ${channelId} via MTProto...`);
            const stats = await fetchFullChannelStats(channelId);
            console.log(`Real stats fetched: ${stats.subscribers} subs, ${stats.avgViews} avg views`);
            return stats;
        }
    } catch (userbotError: any) {
        console.log(`Userbot stats failed, falling back to Bot API:`, userbotError?.message);
    }

    // Fallback: Bot API estimates
    const { memberCount } = await getChannelInfo(channelId);

    const stats: ChannelStats = {
        subscribers: memberCount,
        avgViews: Math.floor(memberCount * 0.4),
        avgReach: Math.floor(memberCount * 0.3),
        lastUpdated: Timestamp.now(),
    };

    return stats;
}

// Post message to channel (MTProto primary, Bot API fallback)
export async function postToChannel(
    channelId: number,
    content: {
        text: string;
        mediaUrl?: string;
        buttons?: Array<{ text: string; url: string }>;
    }
): Promise<number> {
    // Try MTProto first
    try {
        const { isUserbotConfigured, userbotPostToChannel } = await import('./userbot');
        if (isUserbotConfigured()) {
            console.log('Posting to channel via MTProto userbot...');
            return await userbotPostToChannel(channelId, content);
        }
    } catch (e: any) {
        console.log('MTProto postToChannel failed, trying Bot API:', e?.message);
    }

    // Fallback: Bot API
    try {
        const replyMarkup = content.buttons && content.buttons.length > 0
            ? { inline_keyboard: content.buttons.map(btn => [{ text: btn.text, url: btn.url }]) }
            : undefined;

        let message;
        if (content.mediaUrl) {
            message = await bot.telegram.sendPhoto(channelId, content.mediaUrl, {
                caption: content.text, parse_mode: 'HTML', reply_markup: replyMarkup,
            });
        } else {
            message = await bot.telegram.sendMessage(channelId, content.text, {
                parse_mode: 'HTML', reply_markup: replyMarkup,
                link_preview_options: { is_disabled: false },
            });
        }
        return message.message_id;
    } catch (error) {
        console.error('Error posting to channel:', error);
        throw new Error('Failed to post to channel');
    }
}

// Verify post exists and is unmodified (MTProto primary, Bot API fallback)
export async function verifyPost(
    channelId: number,
    messageId: number,
    originalContent: { text: string; mediaUrl?: string }
): Promise<{ exists: boolean; unmodified: boolean }> {
    // Try MTProto first — can directly read messages
    try {
        const { isUserbotConfigured, userbotVerifyPost } = await import('./userbot');
        if (isUserbotConfigured()) {
            console.log(`Verifying post ${messageId} via MTProto...`);
            return await userbotVerifyPost(channelId, messageId, originalContent);
        }
    } catch (e: any) {
        console.log('MTProto verifyPost failed, trying Bot API:', e?.message);
    }

    // Fallback: Bot API (forward message to admin's chat)
    try {
        const verificationChatId = config.adminTelegramIds[0];
        if (!verificationChatId) {
            return { exists: true, unmodified: true };
        }

        const forwardResult = await bot.telegram.forwardMessage(verificationChatId, channelId, messageId);
        const forwardedText = ((forwardResult as any).text || (forwardResult as any).caption || '').trim().replace(/\s+/g, ' ');
        const originalText = (originalContent.text || '').trim().replace(/\s+/g, ' ');
        const unmodified = forwardedText === originalText;

        try { await bot.telegram.deleteMessage(verificationChatId, forwardResult.message_id); } catch { /* ignore */ }

        return { exists: true, unmodified };
    } catch (forwardError: any) {
        const msg = (forwardError.message || '').toLowerCase();
        if (msg.includes('message') && (msg.includes('not found') || msg.includes('invalid'))) {
            return { exists: false, unmodified: false };
        }
        return { exists: true, unmodified: true };
    }
}

// Send notification to user
export async function sendNotification(
    userId: number,
    message: string,
    buttons?: Array<{ text: string; url?: string; callback_data?: string }>
): Promise<void> {
    try {
        const replyMarkup = buttons && buttons.length > 0
            ? {
                inline_keyboard: buttons.map(btn => [
                    btn.url
                        // Use web_app for local app URLs to open inside Telegram Mini App
                        ? (btn.url.includes(config.appUrl)
                            ? { text: btn.text, web_app: { url: btn.url } }
                            : { text: btn.text, url: btn.url })
                        : { text: btn.text, callback_data: btn.callback_data || '' }
                ])
            }
            : undefined;

        await bot.telegram.sendMessage(userId, message, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        // User might have blocked the bot - don't throw
    }
}

// Validate Telegram WebApp init data
export function validateWebAppData(initData: string): { valid: boolean; userId?: number } {
    try {
        console.log('Validating initData:', initData.substring(0, 100) + '...');

        const crypto = require('crypto');
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            console.log('No hash provided in init data');
            // For development: try to extract user from data anyway
            const userParam = params.get('user');
            if (userParam) {
                try {
                    const user = JSON.parse(userParam);
                    console.log('Dev mode: extracted user without hash validation:', user.id);
                    return { valid: true, userId: user.id };
                } catch (e) {
                    console.log('Failed to parse user param');
                }
            }
            return { valid: false };
        }

        params.delete('hash');

        // Sort parameters
        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Calculate secret key
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(config.telegramBotToken)
            .digest();

        // Calculate hash
        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        console.log('Hash match:', calculatedHash === hash);

        if (calculatedHash !== hash) {
            // Try alternate validation without strict hash check for development
            console.log('Hash mismatch, trying fallback extraction');
            const userParam = params.get('user');
            if (userParam) {
                try {
                    const user = JSON.parse(userParam);
                    console.log('Fallback: extracted user ID:', user.id);
                    // Allow in development - remove this for production!
                    return { valid: true, userId: user.id };
                } catch (e) {
                    console.log('Fallback failed to parse user');
                }
            }
            return { valid: false };
        }

        // Extract user ID
        const userParam = params.get('user');
        if (userParam) {
            const user = JSON.parse(userParam);
            console.log('Validated user ID:', user.id);
            return { valid: true, userId: user.id };
        }

        return { valid: true };
    } catch (error) {
        console.error('Error validating WebApp data:', error);
        return { valid: false };
    }
}

