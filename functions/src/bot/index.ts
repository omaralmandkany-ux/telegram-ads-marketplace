// Telegram Bot Handler - command handling, relay messaging, and Mini App integration

import { Telegraf, Markup, Context } from 'telegraf';
import { config, collections } from '../config';
import { db, Timestamp } from '../firebase';
import { User, Channel, Deal } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Lazy initialize bot to prevent deployment timeout
let _bot: Telegraf | null = null;
let _isSetup = false;
let _cachedBotUsername: string | null = null;

// Get bot username via getMe() with caching
async function getBotUsername(): Promise<string> {
    if (_cachedBotUsername) return _cachedBotUsername;
    try {
        const bot = getBot();
        const me = await bot.telegram.getMe();
        _cachedBotUsername = me.username;
        return _cachedBotUsername;
    } catch (e) {
        console.error('Failed to get bot username:', e);
        return 'p2pteleBot'; // fallback
    }
}

function getBot(): Telegraf {
    if (!_bot) {
        _bot = new Telegraf(config.telegramBotToken);
    }
    if (!_isSetup) {
        setupBotHandlers(_bot);
        _isSetup = true;
    }
    return _bot;
}

// Find user by telegramId
async function findUserByTelegramId(telegramId: number): Promise<User | null> {
    const q = await db.collection(collections.users)
        .where('telegramId', '==', telegramId)
        .limit(1).get();
    return q.empty ? null : (q.docs[0].data() as User);
}

// Find active deal for a user (most recent non-completed)
async function findActiveDeal(userId: string): Promise<Deal | null> {
    // Check as advertiser
    let q = await db.collection(collections.deals)
        .where('advertiserId', '==', userId)
        .where('status', 'not-in', ['completed', 'cancelled', 'refunded'])
        .orderBy('updatedAt', 'desc')
        .limit(1).get();

    if (!q.empty) return q.docs[0].data() as Deal;

    // Check as channel owner
    q = await db.collection(collections.deals)
        .where('channelOwnerId', '==', userId)
        .where('status', 'not-in', ['completed', 'cancelled', 'refunded'])
        .orderBy('updatedAt', 'desc')
        .limit(1).get();

    return q.empty ? null : (q.docs[0].data() as Deal);
}

// Setup all bot handlers
function setupBotHandlers(bot: Telegraf): void {
    // Start command - main entry point
    bot.start(async (ctx) => {
        const telegramUser = ctx.from;
        if (!telegramUser) return;

        // Get or create user
        const userQuery = await db.collection(collections.users)
            .where('telegramId', '==', telegramUser.id)
            .limit(1)
            .get();

        let user: User;

        if (userQuery.empty) {
            // Create new user
            user = {
                id: uuidv4(),
                telegramId: telegramUser.id,
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                lastName: telegramUser.last_name,
                role: 'both',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            };

            await db.collection(collections.users).doc(user.id).set(user);
        } else {
            user = userQuery.docs[0].data() as User;
        }

        // Check for deep link parameters
        const startPayload = ctx.message.text.split(' ')[1];

        if (startPayload?.startsWith('channel_')) {
            const channelId = startPayload.replace('channel_', '');
            return ctx.reply(
                `View channel details in the marketplace:`,
                Markup.inlineKeyboard([
                    [Markup.button.webApp('🔍 View Channel', `${config.appUrl}/channels/${channelId}`)]
                ])
            );
        }

        if (startPayload?.startsWith('deal_')) {
            const dealId = startPayload.replace('deal_', '');
            return ctx.reply(
                `View deal details:`,
                Markup.inlineKeyboard([
                    [Markup.button.webApp('📋 View Deal', `${config.appUrl}/deals/${dealId}`)]
                ])
            );
        }

        // Deep link: msg_DEALID - start messaging for a deal
        if (startPayload?.startsWith('msg_')) {
            const dealId = startPayload.replace('msg_', '');
            const dealDoc = await db.collection(collections.deals).doc(dealId).get();
            if (dealDoc.exists) {
                const deal = dealDoc.data() as Deal;
                const isParty = deal.advertiserId === user.id || deal.channelOwnerId === user.id;
                if (isParty) {
                    // Set active deal context for this user
                    await db.collection(collections.users).doc(user.id).update({
                        activeDealChat: dealId,
                        updatedAt: Timestamp.now(),
                    });
                    const role = deal.advertiserId === user.id ? 'Advertiser' : 'Channel Owner';
                    return ctx.reply(
                        `💬 <b>Messaging for Deal #${dealId.slice(0, 8)}</b>\n\n` +
                        `You are: <b>${role}</b>\n` +
                        `Status: <b>${deal.status}</b>\n\n` +
                        `Type your message below and it will be relayed to the other party.\n\n` +
                        `Use /stopchat to stop messaging.`,
                        {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([
                                [Markup.button.webApp('📋 View Deal', `${config.appUrl}/deals/${dealId}`)],
                            ]),
                        }
                    );
                }
            }
            return ctx.reply('Deal not found or you are not a party to this deal.');
        }

        // Default welcome message
        await ctx.reply(
            `👋 Welcome to the <b>Ads Marketplace</b>, ${telegramUser.first_name}!\n\n` +
            `This platform connects channel owners with advertisers for seamless ad placements.\n\n` +
            `<b>For Channel Owners:</b>\n` +
            `• List your channel and set pricing\n` +
            `• Receive ad requests from advertisers\n` +
            `• Get paid securely via TON escrow\n\n` +
            `<b>For Advertisers:</b>\n` +
            `• Browse verified channels\n` +
            `• Create ad campaigns\n` +
            `• Auto-posting with verification\n\n` +
            `Use the buttons below to get started:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('🚀 Open Marketplace', config.appUrl)],
                    [Markup.button.callback('📊 My Channels', 'my_channels')],
                    [Markup.button.callback('📝 My Deals', 'my_deals')],
                    [Markup.button.callback('ℹ️ Help', 'help')],
                ]),
            }
        );
    });

    // Help command
    bot.help(async (ctx) => {
        await ctx.reply(
            `<b>📚 Help & Commands</b>\n\n` +
            `/start - Open the marketplace\n` +
            `/channels - View your registered channels\n` +
            `/deals - View your active deals\n` +
            `/register - Register a new channel\n` +
            `/wallet - Manage your TON wallet\n` +
            `/stopchat - Stop relay messaging\n` +
            `/help - Show this help message\n\n` +
            `<b>💬 Messaging:</b>\n` +
            `Open a deal and tap "Message via Bot" to start a conversation.\n` +
            `Your messages will be relayed to the other party through this bot.\n\n` +
            `<b>How it works:</b>\n\n` +
            `1️⃣ <b>Channel owners</b> register their channels and set ad prices\n` +
            `2️⃣ <b>Advertisers</b> browse channels or create ad requests\n` +
            `3️⃣ Both parties negotiate and agree on terms\n` +
            `4️⃣ Advertiser pays into <b>escrow</b>\n` +
            `5️⃣ Channel owner creates and submits the ad\n` +
            `6️⃣ Advertiser approves the creative\n` +
            `7️⃣ <b>Auto-posting</b> publishes the ad\n` +
            `8️⃣ <b>Verification</b> confirms delivery\n` +
            `9️⃣ Funds released to channel owner\n\n` +
            `All payments are secured via TON blockchain escrow.`,
            { parse_mode: 'HTML' }
        );
    });

    // Stop chat relay command
    bot.command('stopchat', async (ctx) => {
        const telegramUser = ctx.from;
        if (!telegramUser) return;

        const user = await findUserByTelegramId(telegramUser.id);
        if (user) {
            await db.collection(collections.users).doc(user.id).update({
                activeDealChat: null,
                updatedAt: Timestamp.now(),
            });
        }
        await ctx.reply('✅ Chat relay stopped. Your messages will no longer be forwarded.');
    });

    // Channels command
    bot.command('channels', async (ctx) => {
        const telegramUser = ctx.from;
        if (!telegramUser) return;

        const userQuery = await db.collection(collections.users)
            .where('telegramId', '==', telegramUser.id)
            .limit(1)
            .get();

        if (userQuery.empty) {
            return ctx.reply('Please /start the bot first.');
        }

        const user = userQuery.docs[0].data() as User;

        const channelsQuery = await db.collection(collections.channels)
            .where('admins', 'array-contains', user.id)
            .limit(10)
            .get();

        if (channelsQuery.empty) {
            return ctx.reply(
                'You have no registered channels yet.\n\nUse the marketplace to register your channel:',
                Markup.inlineKeyboard([
                    [Markup.button.webApp('➕ Register Channel', `${config.appUrl}/channels/new`)],
                ])
            );
        }

        const channels = channelsQuery.docs.map(doc => doc.data() as Channel);

        let message = '<b>📊 Your Channels</b>\n\n';

        channels.forEach((channel, i) => {
            const status = channel.botIsAdmin ? '✅' : '⚠️';
            message += `${i + 1}. ${status} @${channel.username || channel.title}\n`;
            message += `   👥 ${channel.stats.subscribers.toLocaleString()} subscribers\n`;
            if (channel.pricing.post) {
                message += `   💰 Post: ${channel.pricing.post.price} TON\n`;
            }
            message += '\n';
        });

        if (!channels.every(c => c.botIsAdmin)) {
            message += '\n⚠️ = Bot needs admin access for auto-posting';
        }

        await ctx.reply(message, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.webApp('📊 Manage Channels', `${config.appUrl}/my-channels`)],
                [Markup.button.webApp('➕ Register New', `${config.appUrl}/channels/new`)],
            ]),
        });
    });

    // Deals command
    bot.command('deals', async (ctx) => {
        await ctx.reply(
            'View your deals:',
            Markup.inlineKeyboard([
                [Markup.button.webApp('📋 My Deals', `${config.appUrl}/deals`)],
            ])
        );
    });

    // Wallet command
    bot.command('wallet', async (ctx) => {
        await ctx.reply(
            '💰 <b>TON Wallet</b>\n\n' +
            'Manage your TON wallet for receiving payments:',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('💼 Manage Wallet', `${config.appUrl}/wallet`)],
                ]),
            }
        );
    });

    // Register channel command
    bot.command('register', async (ctx) => {
        await ctx.reply(
            '➕ <b>Register a Channel</b>\n\n' +
            'To register your channel:\n\n' +
            '1️⃣ Add this bot as an <b>admin</b> to your channel\n' +
            '2️⃣ Give it <b>post messages</b> permission\n' +
            '3️⃣ Click the button below to continue\n\n' +
            '⚠️ You must be an admin of the channel to register it.',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('➕ Register Channel', `${config.appUrl}/channels/new`)],
                ]),
            }
        );
    });

    // Callback query handlers
    bot.action('my_channels', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            'View and manage your channels:',
            Markup.inlineKeyboard([
                [Markup.button.webApp('📊 My Channels', `${config.appUrl}/my-channels`)],
            ])
        );
    });

    bot.action('my_deals', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            'View your deals:',
            Markup.inlineKeyboard([
                [Markup.button.webApp('📋 My Deals', `${config.appUrl}/deals`)],
            ])
        );
    });

    bot.action('help', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            'Use /help to see all available commands and how the marketplace works.'
        );
    });

    // ==========================================
    // RELAY MESSAGING - Forward text messages between deal parties
    // ==========================================
    bot.on('text', async (ctx) => {
        const telegramUser = ctx.from;
        if (!telegramUser) return;

        const text = ctx.message.text;
        // Skip if it's a command
        if (text.startsWith('/')) return;

        // Find user
        const user = await findUserByTelegramId(telegramUser.id);
        if (!user) return;

        // Check if user has an active deal chat
        const activeDealId = (user as any).activeDealChat;
        if (!activeDealId) return; // No relay context, ignore the message

        // Get the deal
        const dealDoc = await db.collection(collections.deals).doc(activeDealId).get();
        if (!dealDoc.exists) {
            await ctx.reply('❌ This deal no longer exists. Chat relay stopped.');
            await db.collection(collections.users).doc(user.id).update({ activeDealChat: null });
            return;
        }

        const deal = dealDoc.data() as Deal;

        // Determine parties
        const isAdvertiser = deal.advertiserId === user.id;
        const isOwner = deal.channelOwnerId === user.id;
        if (!isAdvertiser && !isOwner) return;

        const recipientId = isAdvertiser ? deal.channelOwnerId : deal.advertiserId;
        const senderRole = isAdvertiser ? 'Advertiser' : 'Channel Owner';

        // Get recipient user
        const recipientDoc = await db.collection(collections.users).doc(recipientId).get();
        if (!recipientDoc.exists) {
            await ctx.reply('❌ Could not find the other party.');
            return;
        }

        const recipient = recipientDoc.data() as User;

        // Import sendNotification
        const { sendNotification } = require('../services/telegram');

        // Get the actual bot username for deep link
        const botUsername = await getBotUsername();

        // Forward message to recipient
        await sendNotification(
            recipient.telegramId,
            `💬 <b>Message from ${senderRole}</b>\n` +
            `<i>Deal #${deal.id.slice(0, 8)}</i>\n\n` +
            `${text}`,
            [
                { text: '↩️ Reply', url: `https://t.me/${botUsername}?start=msg_${deal.id}` },
                { text: '📋 View Deal', url: `${config.appUrl}/deals/${deal.id}` },
            ]
        );

        // Confirm to sender
        await ctx.reply('✅ Message sent to ' + (isAdvertiser ? 'Channel Owner' : 'Advertiser'));
    });

    // Error handling
    bot.catch((err: any, ctx: Context) => {
        console.error('Bot error:', err);
        ctx.reply('An error occurred. Please try again later.').catch(console.error);
    });
}

// Export webhook handler
export const handleWebhook = async (req: any, res: any) => {
    try {
        const bot = getBot();
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error');
    }
};
