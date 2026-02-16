// Scheduler Service - handles scheduled tasks like auto-posting, verification, and timeouts

import * as functions from 'firebase-functions';
import { db, Timestamp, hoursFromNow } from '../firebase';
import { collections, config, dealStatusTransitions } from '../config';
import { Deal, Channel, Wallet, User } from '../types';
import { postToChannel, verifyPost, sendNotification } from './telegram';
import { releaseEscrow, refundEscrow, getWalletBalance, checkIncomingPayment } from './ton';

// Check for payment received on pending deals
export async function checkPendingPayments(): Promise<void> {
    const pendingDeals = await db
        .collection(collections.deals)
        .where('status', '==', 'pending_payment')
        .get();

    for (const doc of pendingDeals.docs) {
        const deal = doc.data() as Deal;

        // Check if payment received
        const payment = await checkIncomingPayment(
            deal.escrowWalletAddress,
            deal.amount,
            deal.createdAt.toMillis()
        );

        if (payment.received) {
            // Update deal status
            await doc.ref.update({
                status: 'creative_pending',
                escrowBalance: payment.amount,
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Notify channel owner
            const channelOwner = await db.collection(collections.users).doc(deal.channelOwnerId).get();
            if (channelOwner.exists) {
                const user = channelOwner.data() as User;
                await sendNotification(
                    user.telegramId,
                    `💰 <b>Payment Received!</b>\n\nDeal #${deal.id.slice(0, 8)} has received payment of ${payment.amount} TON.\n\nPlease submit your creative for review.`,
                    [{ text: '📝 Submit Creative', url: `${config.appUrl}/deals/${deal.id}` }]
                );
            }
        }
    }
}

// Check for deals that need auto-posting
export async function checkScheduledPosts(): Promise<void> {
    const now = Timestamp.now();

    const scheduledDeals = await db
        .collection(collections.deals)
        .where('status', '==', 'scheduled')
        .where('scheduledTime', '<=', now)
        .get();

    for (const doc of scheduledDeals.docs) {
        const deal = doc.data() as Deal;

        try {
            // Get channel info
            const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
            if (!channelDoc.exists) continue;

            const channel = channelDoc.data() as Channel;

            // Post to channel
            // Determine media URL: use creative mediaUrls first, then brief image if publishWithImage is set
            let mediaUrl = deal.creative?.mediaUrls?.[0];
            if (!mediaUrl && deal.publishWithImage && deal.brief?.suggestedImageUrl) {
                mediaUrl = deal.brief.suggestedImageUrl;
            }

            const messageId = await postToChannel(channel.chatId, {
                text: deal.creative!.text,
                mediaUrl: mediaUrl,
                buttons: deal.creative?.buttons,
            });

            // Update deal
            await doc.ref.update({
                status: 'posted',
                postId: messageId,
                postedAt: Timestamp.now(),
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Notify both parties
            const advertiser = await db.collection(collections.users).doc(deal.advertiserId).get();
            if (advertiser.exists) {
                const user = advertiser.data() as User;
                await sendNotification(
                    user.telegramId,
                    `🎉 <b>Your Ad is Live!</b>\n\nYour ad for deal #${deal.id.slice(0, 8)} has been posted to @${channel.username}.\n\nWe'll verify it stays up for the agreed duration.`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${deal.id}` }]
                );
            }

        } catch (error) {
            console.error(`Failed to auto-post deal ${deal.id}:`, error);

            // Mark as disputed
            await doc.ref.update({
                status: 'disputed',
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
        }
    }
}

// Verify posted content hasn't been deleted or modified
// Uses MTProto userbot for accurate verification when available
export async function verifyPostedContent(): Promise<void> {
    const postedDeals = await db
        .collection(collections.deals)
        .where('status', '==', 'posted')
        .get();

    for (const doc of postedDeals.docs) {
        const deal = doc.data() as Deal;

        // Get channel
        const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
        if (!channelDoc.exists) continue;

        const channel = channelDoc.data() as Channel;

        let verification: { exists: boolean; unmodified: boolean };

        // Try MTProto userbot first for accurate verification
        try {
            const { isUserbotConfigured } = require('./userbot');
            if (isUserbotConfigured()) {
                verification = await verifyPostViaMTProto(
                    channel.chatId,
                    deal.postId!,
                    deal.creative!.text
                );
            } else {
                verification = await verifyPost(
                    channel.chatId,
                    deal.postId!,
                    { text: deal.creative!.text, mediaUrl: deal.creative?.mediaUrls?.[0] }
                );
            }
        } catch (err) {
            console.log('MTProto verify failed, falling back to Bot API:', err);
            verification = await verifyPost(
                channel.chatId,
                deal.postId!,
                { text: deal.creative!.text, mediaUrl: deal.creative?.mediaUrls?.[0] }
            );
        }

        // Add verification check
        const verificationChecks = [...(deal.verificationChecks || []), {
            checkedAt: Timestamp.now(),
            postExists: verification.exists,
            postUnmodified: verification.unmodified,
        }];

        if (!verification.exists || !verification.unmodified) {
            // Post was deleted or modified - auto-dispute
            const reason = !verification.exists ? 'DELETED' : 'MODIFIED';
            console.log(`AUTO-DISPUTE: Deal ${deal.id} — post was ${reason}`);

            await doc.ref.update({
                status: 'disputed',
                disputeReason: `Post was ${reason.toLowerCase()} by channel owner`,
                verificationChecks,
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Notify advertiser
            const advertiser = await db.collection(collections.users).doc(deal.advertiserId).get();
            if (advertiser.exists) {
                const user = advertiser.data() as User;
                await sendNotification(
                    user.telegramId,
                    `⚠️ <b>Deal Dispute</b>\n\nThe post for deal #${deal.id.slice(0, 8)} has been ${reason === 'DELETED' ? 'deleted' : 'edited'} by the channel owner.\n\nA dispute has been automatically opened. We're reviewing the situation.`,
                    [{ text: '🔍 View Details', url: `${config.appUrl}/deals/${deal.id}` }]
                );
            }

            // Notify admin
            const channelOwnerDoc = await db.collection(collections.users).doc(deal.channelOwnerId).get();
            const channelOwner = channelOwnerDoc.exists ? channelOwnerDoc.data() as User : null;
            const advertiserUser = advertiser.exists ? advertiser.data() as User : null;

            for (const adminId of config.adminTelegramIds) {
                await sendNotification(
                    adminId,
                    `🚨 <b>Auto-Dispute: Post ${reason}</b>\n\n` +
                    `<b>Deal:</b> #${deal.id.slice(0, 8)}\n` +
                    `<b>Amount:</b> ${deal.amount} TON\n` +
                    `<b>Channel:</b> @${channel.username}\n` +
                    `<b>Advertiser:</b> ${advertiserUser?.username ? '@' + advertiserUser.username : advertiserUser?.firstName || 'Unknown'}\n` +
                    `<b>Channel Owner:</b> ${channelOwner?.username ? '@' + channelOwner.username : channelOwner?.firstName || 'Unknown'}\n\n` +
                    `The post was automatically detected as ${reason.toLowerCase()}.\n` +
                    `Please review and resolve this dispute.`,
                    [{ text: '⚖️ Review Dispute', url: `${config.appUrl}/admin` }]
                );
            }
        } else {
            // Check if verification period complete
            const postedAt = deal.postedAt!.toMillis();
            const requiredDuration = deal.postDuration * 60 * 60 * 1000; // hours to ms

            if (Date.now() - postedAt >= requiredDuration) {
                // Verification complete - release funds
                await doc.ref.update({
                    status: 'verified',
                    verificationChecks,
                    lastActivityAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });

                // Get escrow wallet and channel owner wallet
                const walletDoc = await db.collection(collections.wallets)
                    .where('ownerId', '==', deal.id)
                    .where('type', '==', 'deal')
                    .get();

                const channelOwner = await db.collection(collections.users).doc(deal.channelOwnerId).get();

                if (!walletDoc.empty && channelOwner.exists) {
                    const escrowWallet = walletDoc.docs[0].data() as Wallet;
                    const owner = channelOwner.data() as User;

                    if (owner.walletAddress) {
                        await releaseEscrow(
                            deal.id,
                            escrowWallet.id,
                            owner.walletAddress,
                            deal.amount
                        );

                        // Notify channel owner
                        await sendNotification(
                            owner.telegramId,
                            `💰 <b>Payment Released!</b>\n\nFunds for deal #${deal.id.slice(0, 8)} have been released to your wallet.\n\nThank you for your successful campaign!`
                        );
                    }
                }
            } else {
                // Just update verification checks
                await doc.ref.update({
                    verificationChecks,
                    lastActivityAt: Timestamp.now(),
                });
            }
        }
    }
}

// Verify a post via MTProto userbot - reads the message directly
async function verifyPostViaMTProto(
    channelId: number,
    messageId: number,
    originalText: string
): Promise<{ exists: boolean; unmodified: boolean }> {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');
    const { Api } = await import('telegram');

    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    const sessionStr = process.env.TELEGRAM_STRING_SESSION || '';

    const session = new StringSession(sessionStr);
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 3,
        useWSS: false,
    });

    try {
        await client.connect();

        const entity = await client.getEntity(channelId);

        // Get the specific message by ID
        const result = await client.invoke(
            new Api.channels.GetMessages({
                channel: entity as any,
                id: [new Api.InputMessageID({ id: messageId })],
            })
        );

        if (!result || !('messages' in result) || result.messages.length === 0) {
            console.log(`MTProto: Message ${messageId} not found in channel ${channelId}`);
            return { exists: false, unmodified: false };
        }

        const msg = result.messages[0];

        // Check if message is empty (deleted)
        if (msg instanceof Api.MessageEmpty) {
            console.log(`MTProto: Message ${messageId} was DELETED`);
            return { exists: false, unmodified: false };
        }

        if (msg instanceof Api.Message) {
            // Check if message was edited
            if (msg.editDate) {
                console.log(`MTProto: Message ${messageId} was EDITED at ${new Date(msg.editDate * 1000).toISOString()}`);
                return { exists: true, unmodified: false };
            }

            // Compare text content
            const currentText = (msg.message || '').trim();
            const original = originalText.trim();

            // Normalize whitespace for comparison
            const normalizedCurrent = currentText.replace(/\s+/g, ' ');
            const normalizedOriginal = original.replace(/\s+/g, ' ');

            if (normalizedCurrent !== normalizedOriginal) {
                console.log(`MTProto: Message ${messageId} text DIFFERS from original`);
                console.log(`  Original: "${normalizedOriginal.substring(0, 80)}..."`);
                console.log(`  Current:  "${normalizedCurrent.substring(0, 80)}..."`);
                return { exists: true, unmodified: false };
            }

            console.log(`MTProto: Message ${messageId} verified OK ✓`);
            return { exists: true, unmodified: true };
        }

        // Unknown message type
        console.log(`MTProto: Unknown message type for ${messageId}`);
        return { exists: true, unmodified: true };

    } finally {
        await client.disconnect();
    }
}

// Handle timeout for inactive deals
export async function handleTimeouts(): Promise<void> {
    const now = Timestamp.now();

    // Find deals past their auto-cancel time
    const expiredDeals = await db
        .collection(collections.deals)
        .where('autoCancelAfter', '<=', now)
        .where('status', 'in', [
            'pending_acceptance',
            'pending_payment',
            'creative_pending',
            'creative_submitted',
            'creative_approved',
        ])
        .get();

    for (const doc of expiredDeals.docs) {
        const deal = doc.data() as Deal;

        // If payment was received, refund
        if (deal.escrowBalance > 0) {
            const walletDoc = await db.collection(collections.wallets)
                .where('ownerId', '==', deal.id)
                .where('type', '==', 'deal')
                .get();

            const advertiser = await db.collection(collections.users).doc(deal.advertiserId).get();

            if (!walletDoc.empty && advertiser.exists) {
                const escrowWallet = walletDoc.docs[0].data() as Wallet;
                const user = advertiser.data() as User;

                if (user.walletAddress) {
                    await refundEscrow(
                        deal.id,
                        escrowWallet.id,
                        user.walletAddress,
                        deal.escrowBalance
                    );
                }
            }
        } else {
            // Just cancel
            await doc.ref.update({
                status: 'cancelled',
                updatedAt: Timestamp.now(),
            });
        }

        // Notify both parties
        const advertiser = await db.collection(collections.users).doc(deal.advertiserId).get();
        const channelOwner = await db.collection(collections.users).doc(deal.channelOwnerId).get();

        if (advertiser.exists) {
            const user = advertiser.data() as User;
            await sendNotification(
                user.telegramId,
                `⏰ <b>Deal Expired</b>\n\nDeal #${deal.id.slice(0, 8)} has been cancelled due to inactivity.${deal.escrowBalance > 0 ? '\n\nYour funds have been refunded.' : ''}`
            );
        }

        if (channelOwner.exists) {
            const user = channelOwner.data() as User;
            await sendNotification(
                user.telegramId,
                `⏰ <b>Deal Expired</b>\n\nDeal #${deal.id.slice(0, 8)} has been cancelled due to inactivity.`
            );
        }
    }
}

// Update channel stats periodically
export async function updateChannelStats(): Promise<void> {
    const channels = await db
        .collection(collections.channels)
        .where('isActive', '==', true)
        .get();

    for (const doc of channels.docs) {
        const channel = doc.data() as Channel;

        try {
            // Dynamically import to avoid circular dependency
            const { fetchChannelStats, checkBotIsAdmin } = await import('./telegram');

            // Update stats
            const stats = await fetchChannelStats(channel.chatId);
            const { isAdmin, canPost } = await checkBotIsAdmin(channel.chatId);

            await doc.ref.update({
                stats,
                botIsAdmin: isAdmin && canPost,
                updatedAt: Timestamp.now(),
            });

            // Store daily growth snapshot (one per day)
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const snapshotRef = doc.ref.collection('growth').doc(today);
            const existing = await snapshotRef.get();
            if (!existing.exists) {
                await snapshotRef.set({
                    date: today,
                    subscribers: stats.subscribers,
                    avgViews: stats.avgViews,
                    avgReach: stats.avgReach,
                    timestamp: Timestamp.now(),
                });
            }
        } catch (error) {
            console.error(`Failed to update stats for channel ${channel.id}:`, error);
        }
    }
}
