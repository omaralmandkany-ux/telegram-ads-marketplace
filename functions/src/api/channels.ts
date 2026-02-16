// Channels API - handles channel registration, stats, and management

import { Request, Response } from 'express';
import { db, Timestamp, hoursFromNow } from '../firebase';
import { collections, config } from '../config';
import { Channel, User, ChannelPricing, ApiResponse, ChannelAdminInfo } from '../types';
import {
    getChannelInfo,
    fetchChannelStats,
    checkBotIsAdmin,
    checkUserIsAdmin,
    getChannelAdmins,
    getChannelAdminsDetailed,
} from '../services/telegram';
import { v4 as uuidv4 } from 'uuid';

// Helper: refresh photo URLs for an array of channels in parallel
async function refreshChannelPhotos(channels: any[]): Promise<any[]> {
    const refreshPromises = channels.map(async (channel) => {
        try {
            if (channel.chatId) {
                const { photoUrl } = await getChannelInfo(channel.chatId);
                if (photoUrl) {
                    channel.photoUrl = photoUrl;
                    // Fire-and-forget: update Firestore in background
                    db.collection(collections.channels).doc(channel.id).update({ photoUrl }).catch(() => { });
                }
            }
        } catch (e) {
            // Ignore errors for individual channels
        }
        return channel;
    });
    return Promise.all(refreshPromises);
}

// Register a new channel
export async function registerChannel(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelUsername, pricing, description, category } = req.body;

    if (!channelUsername) {
        res.status(400).json({ success: false, error: 'Channel username is required' });
        return;
    }

    try {
        // Get channel info from Telegram
        const { chat, memberCount, photoUrl } = await getChannelInfo(`@${channelUsername.replace('@', '')}`);

        if (chat.type !== 'channel') {
            res.status(400).json({ success: false, error: 'Must be a Telegram channel' });
            return;
        }

        // Check if user is admin of the channel
        const isAdmin = await checkUserIsAdmin((chat as any).id, user.telegramId);
        if (!isAdmin) {
            res.status(403).json({
                success: false,
                error: 'You must be an admin of this channel to register it',
            });
            return;
        }

        // Check if bot is admin
        const botStatus = await checkBotIsAdmin((chat as any).id);

        // Check if channel already registered
        const existingChannel = await db
            .collection(collections.channels)
            .where('chatId', '==', (chat as any).id)
            .limit(1)
            .get();

        if (!existingChannel.empty) {
            res.status(400).json({
                success: false,
                error: 'This channel is already registered',
            });
            return;
        }

        // Fetch stats
        const stats = await fetchChannelStats((chat as any).id);

        // Get all admins
        const adminIds = await getChannelAdmins((chat as any).id);

        // Find admin users in our system
        const adminUsers: string[] = [user.id];
        for (const adminTgId of adminIds) {
            if (adminTgId === user.telegramId) continue;

            const adminDoc = await db.collection(collections.users)
                .where('telegramId', '==', adminTgId)
                .limit(1)
                .get();

            if (!adminDoc.empty) {
                adminUsers.push(adminDoc.docs[0].data().id);
            }
        }

        // Create channel - filter out undefined values
        const channel: Channel = {
            id: uuidv4(),
            chatId: (chat as any).id,
            ownerId: user.id,
            admins: adminUsers,
            username: (chat as any).username || null,
            title: (chat as any).title || channelUsername,
            description: description || (chat as any).description || '',
            category: category || 'general',
            photoUrl: photoUrl || undefined,
            stats,
            pricing: pricing || {},
            isActive: true,
            botIsAdmin: botStatus.isAdmin && botStatus.canPost,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        // Remove undefined values before saving
        const cleanChannel = JSON.parse(JSON.stringify(channel));

        await db.collection(collections.channels).doc(channel.id).set(cleanChannel);

        res.json({
            success: true,
            data: channel,
        });
    } catch (error: any) {
        console.error('Error registering channel:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to register channel',
        });
    }
}

// Get channel by ID
export async function getChannel(req: Request, res: Response): Promise<void> {
    const { channelId } = req.params;

    const channelDoc = await db.collection(collections.channels).doc(channelId).get();

    if (!channelDoc.exists) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
    }

    const channelData = channelDoc.data() as any;

    // Refresh photo URL and stats from Telegram
    try {
        if (channelData.chatId) {
            // Refresh photo
            const { photoUrl } = await getChannelInfo(channelData.chatId);
            if (photoUrl) {
                channelData.photoUrl = photoUrl;
            }

            // Refresh full stats via MTProto (userbot) or Bot API fallback
            const freshStats = await fetchChannelStats(channelData.chatId);
            channelData.stats = freshStats;

            // Save refreshed data to Firestore (fire and forget)
            const updateData: any = { stats: freshStats };
            if (photoUrl) updateData.photoUrl = photoUrl;
            channelDoc.ref.update(updateData).catch(() => { });

            // Seed today's growth snapshot (fire and forget)
            const today = new Date().toISOString().split('T')[0];
            const snapshotRef = channelDoc.ref.collection('growth').doc(today);
            snapshotRef.get().then(snap => {
                if (!snap.exists) {
                    snapshotRef.set({
                        date: today,
                        subscribers: freshStats.subscribers,
                        avgViews: freshStats.avgViews,
                        avgReach: freshStats.avgReach,
                        timestamp: Timestamp.now(),
                    }).catch(() => { });
                }
            }).catch(() => { });
        }
    } catch (e) {
        console.log('Could not refresh channel data:', e);
    }

    res.json({
        success: true,
        data: channelData,
    });
}

// List channels with filters
export async function listChannels(req: Request, res: Response): Promise<void> {
    const {
        minSubscribers,
        maxSubscribers,
        minPrice,
        maxPrice,
        category,
        search,
        limit = 20,
        offset = 0,
    } = req.query;

    let query = db.collection(collections.channels)
        .where('isActive', '==', true)
        .where('botIsAdmin', '==', true);

    // Apply filters
    if (minSubscribers) {
        query = query.where('stats.subscribers', '>=', parseInt(minSubscribers as string));
    }

    if (maxSubscribers) {
        query = query.where('stats.subscribers', '<=', parseInt(maxSubscribers as string));
    }

    if (category) {
        query = query.where('category', '==', category);
    }

    // Order by subscribers desc
    query = query.orderBy('stats.subscribers', 'desc');

    // Pagination
    query = query.limit(parseInt(limit as string)).offset(parseInt(offset as string));

    const snapshot = await query.get();

    let channels = snapshot.docs.map(doc => doc.data() as Channel);

    // Client-side filtering for price (since Firestore can't query nested map fields with ranges)
    if (minPrice) {
        const min = parseFloat(minPrice as string);
        channels = channels.filter(c =>
            c.pricing.post?.price !== undefined && c.pricing.post.price >= min
        );
    }

    if (maxPrice) {
        const max = parseFloat(maxPrice as string);
        channels = channels.filter(c =>
            c.pricing.post?.price !== undefined && c.pricing.post.price <= max
        );
    }

    // Client-side search
    if (search) {
        const searchLower = (search as string).toLowerCase();
        channels = channels.filter(c =>
            c.title.toLowerCase().includes(searchLower) ||
            c.username?.toLowerCase().includes(searchLower) ||
            c.description?.toLowerCase().includes(searchLower)
        );
    }

    // Refresh photos from Telegram in parallel
    channels = await refreshChannelPhotos(channels);

    res.json({
        success: true,
        data: channels,
        pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: channels.length === parseInt(limit as string),
        },
    });
}

// Get user's own channels
export async function getMyChannels(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;

    try {
        // Simple query without orderBy to avoid index requirement
        const snapshot = await db.collection(collections.channels)
            .where('admins', 'array-contains', user.id)
            .get();

        let channels = snapshot.docs.map(doc => doc.data() as Channel);

        // Sort client-side
        channels = channels.sort((a, b) => {
            const aTime = (a.createdAt as any)?.seconds || 0;
            const bTime = (b.createdAt as any)?.seconds || 0;
            return bTime - aTime;
        });

        // Refresh photos from Telegram in parallel
        channels = await refreshChannelPhotos(channels);

        res.json({
            success: true,
            data: channels,
        });
    } catch (error: any) {
        console.error('Error getting my channels:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get channels',
        });
    }
}

// Update channel
export async function updateChannel(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelId } = req.params;
    const { pricing, description, category, isActive } = req.body;

    const channelDoc = await db.collection(collections.channels).doc(channelId).get();

    if (!channelDoc.exists) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
    }

    const channel = channelDoc.data() as Channel;

    // Check if user is admin
    if (!channel.admins.includes(user.id)) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    // Re-verify user is still admin on Telegram
    const isAdmin = await checkUserIsAdmin(channel.chatId, user.telegramId);
    if (!isAdmin) {
        res.status(403).json({
            success: false,
            error: 'You are no longer an admin of this channel',
        });
        return;
    }

    const updates: Partial<Channel> = {
        updatedAt: Timestamp.now(),
    };

    if (pricing !== undefined) updates.pricing = pricing;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (isActive !== undefined) updates.isActive = isActive;

    await channelDoc.ref.update(updates);

    const updatedDoc = await channelDoc.ref.get();

    res.json({
        success: true,
        data: updatedDoc.data(),
    });
}

// Refresh channel stats
export async function refreshChannelStats(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelId } = req.params;

    const channelDoc = await db.collection(collections.channels).doc(channelId).get();

    if (!channelDoc.exists) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
    }

    const channel = channelDoc.data() as Channel;

    // Check if user is admin
    if (!channel.admins.includes(user.id)) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    try {
        // Fetch fresh stats
        const stats = await fetchChannelStats(channel.chatId);
        const botStatus = await checkBotIsAdmin(channel.chatId);

        await channelDoc.ref.update({
            stats,
            botIsAdmin: botStatus.isAdmin && botStatus.canPost,
            updatedAt: Timestamp.now(),
        });

        res.json({
            success: true,
            data: {
                ...channel,
                stats,
                botIsAdmin: botStatus.isAdmin && botStatus.canPost,
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to refresh stats',
        });
    }
}

// Verify bot is admin
export async function verifyBotAdmin(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelId } = req.params;

    console.log(`verifyBotAdmin called for channel ${channelId} by user ${user.id}`);

    try {
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();

        if (!channelDoc.exists) {
            console.log('Channel not found');
            res.status(404).json({ success: false, error: 'Channel not found' });
            return;
        }

        const channel = channelDoc.data() as Channel;

        // Check if user is admin
        if (!channel.admins.includes(user.id)) {
            console.log('User not in admins list');
            res.status(403).json({ success: false, error: 'Not authorized' });
            return;
        }

        console.log(`Checking bot admin for chatId: ${channel.chatId}`);
        const botStatus = await checkBotIsAdmin(channel.chatId);
        console.log('Bot status result:', botStatus);

        const newBotIsAdmin = botStatus.isAdmin && botStatus.canPost;
        console.log(`Updating botIsAdmin to: ${newBotIsAdmin}`);

        await channelDoc.ref.update({
            botIsAdmin: newBotIsAdmin,
            updatedAt: Timestamp.now(),
        });

        res.json({
            success: true,
            data: {
                isAdmin: botStatus.isAdmin,
                canPost: botStatus.canPost,
                canDelete: botStatus.canDelete,
            },
        });
    } catch (error: any) {
        console.error('Error in verifyBotAdmin:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to verify bot admin status',
        });
    }
}

// Get channel admins with detailed info
export async function getChannelAdminsHandler(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelId } = req.params;

    try {
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();

        if (!channelDoc.exists) {
            res.status(404).json({ success: false, error: 'Channel not found' });
            return;
        }

        const channel = channelDoc.data() as Channel;

        // Check if user is admin
        if (!channel.admins.includes(user.id)) {
            res.status(403).json({ success: false, error: 'Not authorized' });
            return;
        }

        // Return stored admin details if available
        const adminDetails = channel.adminDetails || [];

        // Also fetch current admins from Telegram for comparison
        const telegramAdmins = await getChannelAdminsDetailed(channel.chatId);

        res.json({
            success: true,
            data: {
                storedAdmins: adminDetails,
                telegramAdmins: telegramAdmins,
                lastSynced: adminDetails.length > 0 ? adminDetails[0].syncedAt : null,
            },
        });
    } catch (error: any) {
        console.error('Error getting channel admins:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get channel admins',
        });
    }
}

// Sync channel admins from Telegram
export async function syncChannelAdmins(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { channelId } = req.params;

    try {
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();

        if (!channelDoc.exists) {
            res.status(404).json({ success: false, error: 'Channel not found' });
            return;
        }

        const channel = channelDoc.data() as Channel;

        // Check if user is admin
        if (!channel.admins.includes(user.id)) {
            res.status(403).json({ success: false, error: 'Not authorized' });
            return;
        }

        // Re-verify user is still admin on Telegram
        const isAdmin = await checkUserIsAdmin(channel.chatId, user.telegramId);
        if (!isAdmin) {
            res.status(403).json({
                success: false,
                error: 'You are no longer an admin of this channel on Telegram',
            });
            return;
        }

        // Fetch admins from Telegram
        const telegramAdmins = await getChannelAdminsDetailed(channel.chatId);

        // Build admin details with our user IDs
        const adminDetails: any[] = [];
        const adminUserIds: string[] = [];

        for (const tgAdmin of telegramAdmins) {
            // Find user in our system
            const userQuery = await db.collection(collections.users)
                .where('telegramId', '==', tgAdmin.telegramId)
                .limit(1)
                .get();

            let userId = '';
            if (!userQuery.empty) {
                userId = userQuery.docs[0].data().id;
                adminUserIds.push(userId);
            }

            adminDetails.push({
                userId: userId,
                telegramId: tgAdmin.telegramId,
                username: tgAdmin.username || null,
                firstName: tgAdmin.firstName,
                lastName: tgAdmin.lastName || null,
                role: tgAdmin.role,
                permissions: tgAdmin.permissions,
                syncedAt: Timestamp.now(),
            });
        }

        // Update channel with new admin info
        await channelDoc.ref.update({
            admins: adminUserIds.length > 0 ? adminUserIds : channel.admins,
            adminDetails: adminDetails,
            updatedAt: Timestamp.now(),
        });

        res.json({
            success: true,
            data: {
                adminDetails: adminDetails,
                totalAdmins: adminDetails.length,
                registeredUsers: adminUserIds.length,
            },
        });
    } catch (error: any) {
        console.error('Error syncing channel admins:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to sync channel admins',
        });
    }
}

// Verify admin status helper - to be used before financial operations
export async function verifyAdminForOperation(
    userId: string,
    userTelegramId: number,
    channelId: string
): Promise<{ isValid: boolean; error?: string }> {
    try {
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();

        if (!channelDoc.exists) {
            return { isValid: false, error: 'Channel not found' };
        }

        const channel = channelDoc.data() as Channel;

        // Check if user is in our admins list
        if (!channel.admins.includes(userId)) {
            return { isValid: false, error: 'User not in channel admins list' };
        }

        // Re-verify on Telegram
        const isAdmin = await checkUserIsAdmin(channel.chatId, userTelegramId);
        if (!isAdmin) {
            // Update our records to remove this admin
            const updatedAdmins = channel.admins.filter(a => a !== userId);
            await channelDoc.ref.update({
                admins: updatedAdmins,
                updatedAt: Timestamp.now(),
            });

            return { isValid: false, error: 'User is no longer an admin on Telegram' };
        }

        return { isValid: true };
    } catch (error: any) {
        console.error('Error verifying admin for operation:', error);
        return { isValid: false, error: 'Failed to verify admin status' };
    }
}

// Get channel growth data (last 30 days)
export async function getChannelGrowth(req: Request, res: Response): Promise<void> {
    const { channelId } = req.params;

    try {
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();
        if (!channelDoc.exists) {
            res.status(404).json({ success: false, error: 'Channel not found' });
            return;
        }

        // Fetch last 30 days of growth data
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const startDate = thirtyDaysAgo.toISOString().split('T')[0];

        const growthDocs = await channelDoc.ref
            .collection('growth')
            .where('date', '>=', startDate)
            .orderBy('date', 'asc')
            .get();

        const growth = growthDocs.docs.map(doc => doc.data());

        res.json({
            success: true,
            data: growth,
        });
    } catch (error: any) {
        console.error('Error fetching growth data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch growth data' });
    }
}
