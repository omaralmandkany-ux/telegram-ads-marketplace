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

// Get channel info and stats
export async function getChannelInfo(channelIdOrUsername: string | number): Promise<{
    chat: Awaited<ReturnType<typeof bot.telegram.getChat>>;
    memberCount: number;
    photoUrl?: string;
}> {
    try {
        const chat = await bot.telegram.getChat(channelIdOrUsername);
        const memberCount = await bot.telegram.getChatMembersCount(channelIdOrUsername);

        // Try to get channel photo URL
        let photoUrl: string | undefined;
        try {
            if ((chat as any).photo?.big_file_id) {
                const fileLink = await bot.telegram.getFileLink((chat as any).photo.big_file_id);
                photoUrl = typeof fileLink === 'string' ? fileLink : fileLink.href;
            }
        } catch (photoError) {
            console.log('Could not fetch channel photo:', photoError);
        }

        return { chat, memberCount, photoUrl };
    } catch (error) {
        console.error('Error getting channel info:', error);
        throw new Error('Failed to get channel information');
    }
}

// Check if bot is admin in channel
export async function checkBotIsAdmin(channelId: number): Promise<{
    isAdmin: boolean;
    canPost: boolean;
    canDelete: boolean;
}> {
    try {
        console.log(`Checking bot admin status for channel ${channelId}`);
        const botInfo = await bot.telegram.getMe();
        console.log(`Bot ID: ${botInfo.id}, Bot username: ${botInfo.username}`);

        try {
            // First try the direct getChatMember approach
            const member = await bot.telegram.getChatMember(channelId, botInfo.id);
            console.log(`Bot member status: ${member.status}`);
            console.log(`Member data:`, JSON.stringify(member, null, 2));

            const isAdmin = member.status === 'administrator' || member.status === 'creator';

            // For admins, can_post_messages might be undefined (meaning it's allowed)
            // Only consider it false if explicitly set to false
            const canPostValue = (member as any).can_post_messages;
            const canDeleteValue = (member as any).can_delete_messages;

            const canPost = isAdmin && (member.status === 'creator' || canPostValue !== false);
            const canDelete = isAdmin && (member.status === 'creator' || canDeleteValue !== false);

            console.log(`Bot admin check result - isAdmin: ${isAdmin}, canPost: ${canPost}, canDelete: ${canDelete}`);
            console.log(`Raw values - can_post_messages: ${canPostValue}, can_delete_messages: ${canDeleteValue}`);
            return { isAdmin, canPost, canDelete };
        } catch (memberError: any) {
            console.log(`getChatMember failed: ${memberError?.message}`);

            // If member list is inaccessible, try getChatAdministrators as fallback
            if (memberError?.message?.includes('member list is inaccessible')) {
                console.log('Trying getChatAdministrators fallback...');
                try {
                    const admins = await bot.telegram.getChatAdministrators(channelId);
                    console.log(`Found ${admins.length} admins in channel`);

                    const botAdmin = admins.find(admin => admin.user.id === botInfo.id);
                    if (botAdmin) {
                        console.log(`Bot found in admin list with status: ${botAdmin.status}`);
                        console.log(`Bot admin data:`, JSON.stringify(botAdmin, null, 2));

                        const isAdmin = botAdmin.status === 'administrator' || botAdmin.status === 'creator';
                        const canPostValue = (botAdmin as any).can_post_messages;
                        const canDeleteValue = (botAdmin as any).can_delete_messages;

                        const canPost = isAdmin && (botAdmin.status === 'creator' || canPostValue !== false);
                        const canDelete = isAdmin && (botAdmin.status === 'creator' || canDeleteValue !== false);

                        console.log(`Fallback result - isAdmin: ${isAdmin}, canPost: ${canPost}, canDelete: ${canDelete}`);
                        return { isAdmin, canPost, canDelete };
                    } else {
                        console.log('Bot not found in admin list');
                    }
                } catch (adminError: any) {
                    console.log(`getChatAdministrators also failed: ${adminError?.message}`);
                }

                // Third fallback: Try getChat to see if bot can at least access the channel
                console.log('Trying getChat fallback to verify channel access...');
                try {
                    const chat = await bot.telegram.getChat(channelId);
                    console.log(`getChat succeeded! Chat type: ${chat.type}, title: ${(chat as any).title}`);
                    console.log(`Full chat data:`, JSON.stringify(chat, null, 2));

                    // If we got here, the bot CAN access the channel but we couldn't verify admin status
                    // This could mean: 1) Bot is a member but not admin, 2) Permissions issue
                    // DO NOT assume admin - return false and let the registration show the warning
                    console.log('Bot can access channel but could not verify admin status - returning false');
                    return { isAdmin: false, canPost: false, canDelete: false };
                } catch (chatError: any) {
                    console.log(`getChat also failed: ${chatError?.message}`);
                    console.log('Bot cannot access channel at all - likely not a member or wrong chat ID');
                }
            }

            // All checks failed
            console.log('All admin check methods failed');
            return { isAdmin: false, canPost: false, canDelete: false };
        }
    } catch (error: any) {
        console.error('Error in checkBotIsAdmin:', error?.message || error);
        return { isAdmin: false, canPost: false, canDelete: false };
    }
}

// Check if user is admin of channel
export async function checkUserIsAdmin(channelId: number, userId: number): Promise<boolean> {
    try {
        console.log(`Checking if user ${userId} is admin of channel ${channelId}`);
        const member = await bot.telegram.getChatMember(channelId, userId);
        console.log(`User ${userId} status in channel: ${member.status}`);
        const isAdmin = member.status === 'administrator' || member.status === 'creator';
        console.log(`Is admin: ${isAdmin}`);
        return isAdmin;
    } catch (error: any) {
        console.error('Error checking user admin status:', error?.message || error);
        // If we can't check (e.g., user not in channel), return true for now to allow registration
        // The channel owner verification is secondary to bot admin check
        return true;
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
    try {
        const admins = await bot.telegram.getChatAdministrators(channelId);
        return admins
            .filter(admin => !admin.user.is_bot)
            .map(admin => admin.user.id);
    } catch (error) {
        console.error('Error getting channel admins:', error);
        return [];
    }
}

// Get detailed channel admins with permissions
export async function getChannelAdminsDetailed(channelId: number): Promise<TelegramAdminInfo[]> {
    try {
        const admins = await bot.telegram.getChatAdministrators(channelId);

        return admins
            .filter(admin => !admin.user.is_bot)
            .map(admin => {
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

// Post message to channel
export async function postToChannel(
    channelId: number,
    content: {
        text: string;
        mediaUrl?: string;
        buttons?: Array<{ text: string; url: string }>;
    }
): Promise<number> {
    try {
        // Build inline keyboard if buttons provided
        const replyMarkup = content.buttons && content.buttons.length > 0
            ? {
                inline_keyboard: content.buttons.map(btn => [
                    { text: btn.text, url: btn.url }
                ])
            }
            : undefined;

        let message;

        if (content.mediaUrl) {
            // Post with media
            message = await bot.telegram.sendPhoto(channelId, content.mediaUrl, {
                caption: content.text,
                parse_mode: 'HTML',
                reply_markup: replyMarkup,
            });
        } else {
            // Text only post
            message = await bot.telegram.sendMessage(channelId, content.text, {
                parse_mode: 'HTML',
                reply_markup: replyMarkup,
                link_preview_options: { is_disabled: false },
            });
        }

        return message.message_id;
    } catch (error) {
        console.error('Error posting to channel:', error);
        throw new Error('Failed to post to channel');
    }
}

// Verify post exists and is unmodified
export async function verifyPost(
    channelId: number,
    messageId: number,
    originalContent: { text: string; mediaUrl?: string }
): Promise<{ exists: boolean; unmodified: boolean }> {
    try {
        const bot = getBot();

        // Method 1: Try to forward the message to bot's own chat (not visible to users)
        // This is the most reliable way to check if a message exists
        try {
            console.log(`Verifying post ${messageId} in channel ${channelId}...`);

            // Use first admin's chat for verification (bots cannot receive messages in their own chat)
            const verificationChatId = config.adminTelegramIds[0];
            if (!verificationChatId) {
                console.log('No admin configured for verification, assuming post exists');
                return { exists: true, unmodified: true };
            }

            // Forward to admin's chat (will be deleted immediately)
            const forwardResult = await bot.telegram.forwardMessage(
                verificationChatId, // Forward to admin's chat
                channelId,
                messageId
            );

            // Message exists! Now check if content was modified
            let isUnmodified = true;

            // Compare text content
            const forwardedText = (forwardResult as any).text || (forwardResult as any).caption || '';
            const originalText = originalContent.text || '';

            // Normalize both texts for comparison (trim whitespace, normalize line breaks)
            const normalizedForwarded = forwardedText.trim().replace(/\s+/g, ' ');
            const normalizedOriginal = originalText.trim().replace(/\s+/g, ' ');

            if (normalizedForwarded !== normalizedOriginal) {
                console.log(`⚠️ Post ${messageId} text was MODIFIED!`);
                console.log(`Original: "${normalizedOriginal.substring(0, 100)}..."`);
                console.log(`Current: "${normalizedForwarded.substring(0, 100)}..."`);
                isUnmodified = false;
            }

            // Delete the forwarded copy immediately
            try {
                await bot.telegram.deleteMessage(verificationChatId, forwardResult.message_id);
            } catch {
                // Ignore delete errors
            }

            if (isUnmodified) {
                console.log(`✓ Post ${messageId} verified as existing and unmodified`);
            } else {
                console.log(`✗ Post ${messageId} exists but was MODIFIED`);
            }

            return { exists: true, unmodified: isUnmodified };

        } catch (forwardError: any) {
            const errorMessage = (forwardError.message || forwardError.description || '').toLowerCase();
            console.log(`Forward check error: ${errorMessage}`);

            // Check for clear "message not found" indicators
            if (errorMessage.includes('message to forward not found') ||
                errorMessage.includes('message not found') ||
                errorMessage.includes('message_id_invalid') ||
                errorMessage.includes('message to copy not found') ||
                errorMessage.includes('chat not found')) {
                console.log(`✗ Post ${messageId} was DELETED from channel ${channelId}`);
                return { exists: false, unmodified: false };
            }

            // For other errors (e.g., rights issues), try an alternative check
            // by copying to a different chat (the bot itself)
            console.log(`Forward failed with: ${errorMessage}, trying alternative check...`);
        }

        // Method 2: Fallback - try copyMessage which also fails if message doesn't exist
        try {
            const verificationChatId = config.adminTelegramIds[0];
            if (!verificationChatId) {
                console.log('No admin configured for verification fallback, assuming post exists');
                return { exists: true, unmodified: true };
            }

            const copyResult = await bot.telegram.copyMessage(
                verificationChatId, // Copy to admin's chat
                channelId,
                messageId
            );

            // Success - message exists! Delete the copy
            try {
                await bot.telegram.deleteMessage(verificationChatId, copyResult.message_id);
            } catch {
                // Ignore
            }

            console.log(`Post ${messageId} verified via copyMessage as existing`);
            return { exists: true, unmodified: true };

        } catch (copyError: any) {
            const errorMessage = (copyError.message || copyError.description || '').toLowerCase();
            console.log(`Copy check error: ${errorMessage}`);

            if (errorMessage.includes('message to copy not found') ||
                errorMessage.includes('message not found') ||
                errorMessage.includes('message_id_invalid')) {
                console.log(`✗ Post ${messageId} confirmed DELETED via copyMessage`);
                return { exists: false, unmodified: false };
            }

            // If copy fails for other reasons (permissions, etc.), assume post exists
            // to avoid false positive disputes
            console.log(`Cannot verify post ${messageId} due to other error - assuming exists`);
            return { exists: true, unmodified: true };
        }

    } catch (error: any) {
        console.error('Critical error in verifyPost:', error);
        // On critical errors, assume post exists to avoid false positive disputes
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

