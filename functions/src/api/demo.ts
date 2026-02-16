// Demo API - Testing endpoints for demo mode

import { Request, Response } from 'express';
import { db, Timestamp } from '../firebase';
import { collections, config } from '../config';
import { Deal, User, Channel } from '../types';
import { postToChannel } from '../services/telegram';

// Get demo mode status and balance
export async function getDemoStatus(req: Request, res: Response): Promise<void> {
    res.json({
        success: true,
        data: {
            demoMode: config.demoMode,
            demoBalance: config.demoBalance,
            message: config.demoMode
                ? 'Demo mode is active. Payments are simulated.'
                : 'Live mode. Real TON payments required.',
        },
    });
}

// Simulate posting to channel (actually posts using bot)
export async function simulatePost(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { text, mediaUrl } = req.body;

    if (!config.demoMode) {
        res.status(400).json({
            success: false,
            error: 'This endpoint only works in demo mode',
        });
        return;
    }

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Check authorization
    if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    // Get channel
    const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
    if (!channelDoc.exists) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
    }

    const channel = channelDoc.data() as Channel;

    // Use provided text or creative from deal
    const postText = text || deal.creative?.text || '🧪 Demo post from P2P Ads Marketplace';

    try {
        console.log(`Attempting to post to channel ${channel.chatId}`);

        // Actually post to the channel
        const messageId = await postToChannel(channel.chatId, {
            text: postText,
            mediaUrl: mediaUrl || deal.creative?.mediaUrls?.[0],
        });

        // Update deal status
        await dealDoc.ref.update({
            status: 'posted',
            postId: messageId,
            postedAt: Timestamp.now(),
            lastActivityAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        res.json({
            success: true,
            data: {
                messageId,
                channelId: channel.chatId,
                channelUsername: channel.username,
                postedText: postText.slice(0, 100) + '...',
                message: '✅ Post published successfully to the channel!',
            },
        });
    } catch (error: any) {
        console.error('Error posting to channel:', error);
        res.status(500).json({
            success: false,
            error: `Failed to post: ${error.message}`,
        });
    }
}

// Quick submit creative and approve (all-in-one for testing)
export async function quickTestFlow(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { text } = req.body;

    if (!config.demoMode) {
        res.status(400).json({
            success: false,
            error: 'This endpoint only works in demo mode',
        });
        return;
    }

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Check authorization
    if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    const postText = text || '🧪 This is a demo advertisement posted via P2P Ads Marketplace!\n\n✨ Your ad content goes here.';

    // Update deal with creative and advance to scheduled
    const updates = {
        creative: {
            text: postText,
            submittedAt: Timestamp.now(),
            approvedAt: Timestamp.now(),
        },
        status: 'scheduled',
        scheduledTime: Timestamp.now(),
        lastActivityAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    };

    await dealDoc.ref.update(updates);

    res.json({
        success: true,
        data: {
            dealId: deal.id,
            status: 'scheduled',
            nextStep: 'Use POST /demo/:dealId/post to publish the ad to the channel',
            message: '✅ Creative submitted and approved! Ready to post.',
        },
    });
}
