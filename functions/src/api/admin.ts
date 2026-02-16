// Admin API endpoints - for dispute resolution and admin management

import { Router, Request, Response } from 'express';
import { db, Timestamp } from '../firebase';
import { collections, config } from '../config';
import { Deal, User, Channel } from '../types';
import { sendNotification } from '../services/telegram';
import { releaseEscrow, refundEscrow, sendTon, getWalletBalance } from '../services/ton';

const router = Router();

// Middleware to check if user is admin
const isAdmin = async (req: Request, res: Response, next: Function) => {
    const userId = (req as any).user?.id;
    if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    // Get user's telegram ID
    const userDoc = await db.collection(collections.users).doc(userId).get();
    if (!userDoc.exists) {
        res.status(401).json({ success: false, error: 'User not found' });
        return;
    }

    const user = userDoc.data() as User;
    const userTelegramId = Number(user.telegramId);
    const isAdminUser = config.adminTelegramIds.some(adminId => Number(adminId) === userTelegramId);

    if (!isAdminUser) {
        res.status(403).json({ success: false, error: 'Access denied - Admin only' });
        return;
    }

    next();
};

// GET /admin/disputes - Get all disputed deals
router.get('/disputes', isAdmin, async (req: Request, res: Response) => {
    try {
        console.log('Admin disputes - querying deals with status=disputed');
        const disputesSnapshot = await db
            .collection(collections.deals)
            .where('status', '==', 'disputed')
            .get();

        console.log(`Admin disputes - found ${disputesSnapshot.size} disputed deals`);

        const disputes = await Promise.all(
            disputesSnapshot.docs.map(async (doc) => {
                const deal = { id: doc.id, ...doc.data() } as Deal;

                // Get advertiser info
                const advertiserDoc = await db.collection(collections.users).doc(deal.advertiserId).get();
                const advertiser = advertiserDoc.exists ? advertiserDoc.data() as User : null;

                // Get channel owner info
                const channelOwnerDoc = await db.collection(collections.users).doc(deal.channelOwnerId).get();
                const channelOwner = channelOwnerDoc.exists ? channelOwnerDoc.data() as User : null;

                // Get channel info
                const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
                const channel = channelDoc.exists ? channelDoc.data() as Channel : null;

                return {
                    ...deal,
                    advertiser: advertiser ? {
                        id: advertiserDoc.id,
                        username: advertiser.username,
                        firstName: advertiser.firstName,
                    } : null,
                    channelOwner: channelOwner ? {
                        id: channelOwnerDoc.id,
                        username: channelOwner.username,
                        firstName: channelOwner.firstName,
                    } : null,
                    channel: channel ? {
                        id: channelDoc.id,
                        title: channel.title,
                        username: channel.username,
                    } : null,
                };
            })
        );

        res.json({ success: true, data: disputes });
    } catch (error: any) {
        console.error('Error fetching disputes:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch disputes' });
    }
});

// GET /admin/disputes/:dealId - Get single dispute details
router.get('/disputes/:dealId', isAdmin, async (req: Request, res: Response) => {
    try {
        const { dealId } = req.params;

        const dealDoc = await db.collection(collections.deals).doc(dealId).get();
        if (!dealDoc.exists) {
            res.status(404).json({ success: false, error: 'Deal not found' });
            return;
        }

        const deal = { id: dealDoc.id, ...dealDoc.data() } as Deal;

        // Get all related info
        const [advertiserDoc, channelOwnerDoc, channelDoc] = await Promise.all([
            db.collection(collections.users).doc(deal.advertiserId).get(),
            db.collection(collections.users).doc(deal.channelOwnerId).get(),
            db.collection(collections.channels).doc(deal.channelId).get(),
        ]);

        // Get messages
        const messagesSnapshot = await db
            .collection(collections.messages)
            .where('dealId', '==', dealId)
            .orderBy('createdAt', 'asc')
            .get();

        const messages = messagesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.json({
            success: true,
            data: {
                ...deal,
                advertiser: advertiserDoc.exists ? { id: advertiserDoc.id, ...advertiserDoc.data() } : null,
                channelOwner: channelOwnerDoc.exists ? { id: channelOwnerDoc.id, ...channelOwnerDoc.data() } : null,
                channel: channelDoc.exists ? { id: channelDoc.id, ...channelDoc.data() } : null,
                messages,
            },
        });
    } catch (error: any) {
        console.error('Error fetching dispute:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch dispute' });
    }
});

// POST /admin/disputes/:dealId/resolve - Resolve a dispute
router.post('/disputes/:dealId/resolve', isAdmin, async (req: Request, res: Response) => {
    try {
        const { dealId } = req.params;
        const { resolution, reason } = req.body;

        if (!resolution || !['refund', 'release'].includes(resolution)) {
            res.status(400).json({ success: false, error: 'Invalid resolution. Use "refund" or "release"' });
            return;
        }

        const dealDoc = await db.collection(collections.deals).doc(dealId).get();
        if (!dealDoc.exists) {
            res.status(404).json({ success: false, error: 'Deal not found' });
            return;
        }

        const deal = dealDoc.data() as Deal;

        if (deal.status !== 'disputed') {
            res.status(400).json({ success: false, error: 'Deal is not in disputed status' });
            return;
        }

        // Get user info for notifications
        const [advertiserDoc, channelOwnerDoc] = await Promise.all([
            db.collection(collections.users).doc(deal.advertiserId).get(),
            db.collection(collections.users).doc(deal.channelOwnerId).get(),
        ]);

        const advertiser = advertiserDoc.exists ? advertiserDoc.data() as User : null;
        const channelOwner = channelOwnerDoc.exists ? channelOwnerDoc.data() as User : null;

        if (resolution === 'refund') {
            // Refund advertiser - actually send TON back
            // Get advertiser wallet: from deal (saved during TonConnect payment) or from user profile
            const refundAddress = deal.advertiserWalletAddress || advertiser?.walletAddress || '';
            const escrowId = deal.escrowWalletId || '';

            if (!escrowId) {
                console.error(`Refund failed for deal ${dealId}: no escrow wallet ID`);
            } else if (!refundAddress) {
                console.error(`Refund failed for deal ${dealId}: no advertiser wallet address`);
            } else {
                const refundResult = await refundEscrow(
                    dealId,
                    escrowId,
                    refundAddress,
                    deal.amount
                );
                console.log(`Refund result for deal ${dealId}:`, refundResult);
                if (!refundResult.success) {
                    console.error(`Refund failed for deal ${dealId}:`, refundResult.error);
                }
            }

            await dealDoc.ref.update({
                status: 'refunded',
                adminResolution: {
                    resolution: 'refund',
                    reason: reason || 'Admin decision: Refund to advertiser',
                    resolvedAt: Timestamp.now(),
                    resolvedBy: (req as any).user?.id,
                },
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Notify advertiser
            if (advertiser) {
                await sendNotification(
                    advertiser.telegramId,
                    `✅ <b>Dispute Resolved - Refund</b>\n\nYour dispute for deal #${dealId.slice(0, 8)} has been resolved in your favor.\n\nThe ${deal.amount} TON will be refunded to you.\n\n${reason ? `Reason: ${reason}` : ''}`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${dealId}` }]
                );
            }

            // Notify channel owner
            if (channelOwner) {
                await sendNotification(
                    channelOwner.telegramId,
                    `❌ <b>Dispute Resolved - Refund</b>\n\nThe dispute for deal #${dealId.slice(0, 8)} has been resolved.\n\nThe funds have been refunded to the advertiser.\n\n${reason ? `Reason: ${reason}` : ''}`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${dealId}` }]
                );
            }

        } else {
            // Release to channel owner - actually send TON
            if (!deal.escrowWalletId) {
                res.status(400).json({ success: false, error: 'No escrow wallet ID found on this deal. It may have been created before the fix.' });
                return;
            }

            // Get channel owner's wallet address
            const recipientAddress = channelOwner?.walletAddress || '';

            if (!recipientAddress) {
                res.status(400).json({
                    success: false,
                    error: 'Channel owner has not connected a wallet. They must connect their TON wallet before funds can be released.'
                });
                return;
            }

            const releaseResult = await releaseEscrow(
                dealId,
                deal.escrowWalletId,
                recipientAddress,
                deal.amount
            );
            console.log(`Release result for deal ${dealId}:`, releaseResult);

            if (!releaseResult.success) {
                res.status(500).json({
                    success: false,
                    error: `Failed to send TON to channel owner: ${releaseResult.error}`
                });
                return;
            }

            await dealDoc.ref.update({
                status: 'completed',
                adminResolution: {
                    resolution: 'release',
                    reason: reason || 'Admin decision: Release to channel owner',
                    resolvedAt: Timestamp.now(),
                    resolvedBy: (req as any).user?.id,
                },
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Notify channel owner
            if (channelOwner) {
                await sendNotification(
                    channelOwner.telegramId,
                    `✅ <b>Dispute Resolved - Payment Released</b>\n\nThe dispute for deal #${dealId.slice(0, 8)} has been resolved in your favor.\n\nThe ${deal.amount} TON has been released to you.\n\n${reason ? `Reason: ${reason}` : ''}`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${dealId}` }]
                );
            }

            // Notify advertiser
            if (advertiser) {
                await sendNotification(
                    advertiser.telegramId,
                    `ℹ️ <b>Dispute Resolved</b>\n\nThe dispute for deal #${dealId.slice(0, 8)} has been resolved.\n\nThe funds have been released to the channel owner.\n\n${reason ? `Reason: ${reason}` : ''}`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${dealId}` }]
                );
            }
        }

        res.json({
            success: true,
            message: `Dispute resolved: ${resolution === 'refund' ? 'Refunded to advertiser' : 'Released to channel owner'}`
        });

    } catch (error: any) {
        console.error('Error resolving dispute:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to resolve dispute' });
    }
});

// GET /admin/check - Check if user is admin
router.get('/check', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        console.log('Admin check - userId:', userId);

        if (!userId) {
            console.log('Admin check - No userId');
            res.json({ success: true, isAdmin: false });
            return;
        }

        const userDoc = await db.collection(collections.users).doc(userId).get();
        if (!userDoc.exists) {
            console.log('Admin check - User doc not found');
            res.json({ success: true, isAdmin: false });
            return;
        }

        const user = userDoc.data() as User;
        const userTelegramId = Number(user.telegramId);
        console.log('Admin check - User telegramId:', userTelegramId, 'type:', typeof user.telegramId, 'adminIds:', config.adminTelegramIds);

        const isAdminUser = config.adminTelegramIds.some(adminId => Number(adminId) === userTelegramId);
        console.log('Admin check - isAdmin:', isAdminUser);

        res.json({ success: true, isAdmin: isAdminUser });
    } catch (error: any) {
        console.error('Admin check error:', error);
        res.json({ success: true, isAdmin: false });
    }
});

// POST /admin/recover-funds - Recover stuck funds from an escrow wallet
router.post('/recover-funds', isAdmin, async (req: Request, res: Response) => {
    try {
        const { escrowWalletId, escrowAddress, toAddress } = req.body;

        if (!toAddress) {
            res.status(400).json({ success: false, error: 'toAddress is required' });
            return;
        }

        // If escrowWalletId is provided, use it directly
        // Otherwise, search for the wallet by address
        let walletId = escrowWalletId;

        if (!walletId && escrowAddress) {
            const walletSnapshot = await db.collection(collections.wallets)
                .where('address', '==', escrowAddress)
                .limit(1)
                .get();

            if (!walletSnapshot.empty) {
                walletId = walletSnapshot.docs[0].id;
            }
        }

        if (!walletId) {
            res.status(404).json({ success: false, error: 'Wallet not found. Provide escrowWalletId or escrowAddress.' });
            return;
        }

        // Check current balance
        const walletDoc = await db.collection(collections.wallets).doc(walletId).get();
        if (!walletDoc.exists) {
            res.status(404).json({ success: false, error: 'Wallet document not found in Firestore' });
            return;
        }

        const walletData = walletDoc.data();
        const balance = await getWalletBalance(walletData?.address || escrowAddress);
        console.log(`Admin recovery: wallet ${walletId} balance = ${balance} TON`);

        if (balance <= 0) {
            res.json({
                success: false,
                error: 'Wallet has 0 balance. Nothing to recover.',
                balance,
            });
            return;
        }

        // Send ALL remaining funds to the destination
        const result = await sendTon(
            walletId,
            toAddress,
            0,
            'Admin fund recovery',
            true // sendAll
        );

        res.json({
            success: result.success,
            data: {
                walletId,
                balance,
                toAddress,
                txHash: result.txHash,
                error: result.error,
            },
        });
    } catch (error: any) {
        console.error('Error recovering funds:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to recover funds' });
    }
});

export default router;
