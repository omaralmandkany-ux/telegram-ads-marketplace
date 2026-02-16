// Deals API - handles the complete deal lifecycle with escrow

import { Request, Response } from 'express';
import { db, Timestamp, hoursFromNow } from '../firebase';
import { collections, config, dealStatusTransitions, tonAmounts } from '../config';
import { Deal, User, Channel, AdRequest, Message, Wallet, DealStatus, AdBrief, CreativeSubmission } from '../types';
import { sendNotification, checkUserIsAdmin } from '../services/telegram';
import { generateWallet, formatAddress, getWalletBalance, checkIncomingPayment } from '../services/ton';
import { v4 as uuidv4 } from 'uuid';

// Create a new deal
export async function createDeal(req: Request, res: Response): Promise<void> {
    try {
        const user = (req as any).user as User;
        const {
            channelId,
            sourceType,
            sourceId,
            amount,
            format,
            postDuration,
            scheduledTime,
            // Brief data
            suggestedText,
            suggestedImageUrl,
            publishTime,
            additionalNotes,
            hashtags,
            callToAction,
            publishWithImage,
        } = req.body;

        if (!channelId || !sourceType || !amount) {
            res.status(400).json({
                success: false,
                error: 'channelId, sourceType, and amount are required',
            });
            return;
        }

        if (amount < tonAmounts.minDealAmount) {
            res.status(400).json({
                success: false,
                error: `Minimum deal amount is ${tonAmounts.minDealAmount} TON`,
            });
            return;
        }

        // Get channel
        const channelDoc = await db.collection(collections.channels).doc(channelId).get();
        if (!channelDoc.exists) {
            res.status(404).json({ success: false, error: 'Channel not found' });
            return;
        }

        const channel = channelDoc.data() as Channel;

        // Determine advertiser and channel owner based on source type
        let advertiserId: string;
        let channelOwnerId: string = channel.ownerId;

        if (sourceType === 'listing') {
            // Advertiser is creating deal from channel listing
            advertiserId = user.id;

            // In demo mode, allow self-dealing for testing
            if (!config.demoMode && channel.admins.includes(user.id)) {
                res.status(400).json({
                    success: false,
                    error: 'You cannot create a deal with your own channel',
                });
                return;
            }
        } else if (sourceType === 'request') {
            // Advertiser is accepting a channel that applied to their ad request
            if (!sourceId) {
                res.status(400).json({ success: false, error: 'sourceId is required for request type' });
                return;
            }

            // Get the ad request
            const requestDoc = await db.collection(collections.adRequests).doc(sourceId).get();
            if (!requestDoc.exists) {
                res.status(404).json({ success: false, error: 'Ad request not found' });
                return;
            }

            const adRequest = requestDoc.data() as AdRequest;

            // Verify user is the advertiser who created the request
            if (adRequest.advertiserId !== user.id) {
                res.status(403).json({
                    success: false,
                    error: 'Only the advertiser can accept channels for this request',
                });
                return;
            }

            // Verify channel has applied to this request
            if (!adRequest.applicants.includes(channelId)) {
                res.status(400).json({
                    success: false,
                    error: 'This channel has not applied to this request',
                });
                return;
            }

            advertiserId = user.id;
            channelOwnerId = channel.ownerId;
        } else {
            res.status(400).json({ success: false, error: 'Invalid source type' });
            return;
        }

        const dealId = uuidv4();

        // In demo mode, skip escrow wallet generation
        let escrowAddress = '';
        let escrowWalletId = '';
        if (!config.demoMode) {
            const escrowWallet = await generateWallet(dealId, 'deal');
            escrowAddress = escrowWallet.address;
            escrowWalletId = escrowWallet.id;
        } else {
            escrowAddress = 'DEMO_WALLET_' + dealId.slice(0, 8);
        }

        // Initial status logic:
        // - listing: advertiser creates + pays immediately → start at pending_payment
        //   so check-payment can confirm and advance to creative_pending
        // - request: channel owner accepted a request → pending_acceptance
        // - demo mode: skip to creative_pending for easier testing
        let initialStatus: string;
        if (config.demoMode) {
            initialStatus = 'creative_pending';
        } else if (sourceType === 'listing') {
            initialStatus = 'pending_payment'; // Advertiser pays immediately on create
        } else {
            initialStatus = 'pending_acceptance';
        }
        const initialBalance = config.demoMode ? amount : 0;

        // Build the brief object if any brief data provided (exclude undefined values for Firestore)
        let brief: AdBrief | undefined = undefined;
        if (suggestedText || suggestedImageUrl || publishTime || additionalNotes || hashtags || callToAction) {
            brief = {};
            if (suggestedText) brief.suggestedText = suggestedText;
            if (suggestedImageUrl) brief.suggestedImageUrl = suggestedImageUrl;
            if (publishTime) brief.publishTime = Timestamp.fromDate(new Date(publishTime));
            if (additionalNotes) brief.additionalNotes = additionalNotes;
            if (hashtags && hashtags.length > 0) brief.hashtags = hashtags;
            if (callToAction) brief.callToAction = callToAction;
        }

        // Create the deal - build object conditionally to avoid undefined values
        const deal: any = {
            id: dealId,
            channelId,
            channelOwnerId,
            advertiserId,
            sourceType,
            sourceId: sourceId || channelId,
            amount,
            format: format || 'post',
            status: initialStatus,
            publishWithImage: publishWithImage || false,
            postDuration: postDuration || 24, // Default 24 hours
            verificationChecks: [],
            escrowWalletAddress: escrowAddress,
            escrowWalletId: escrowWalletId || '',
            escrowBalance: initialBalance,
            lastActivityAt: Timestamp.now(),
            autoCancelAfter: hoursFromNow(config.escrowTimeoutHours),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        // Only add optional fields if they have values
        if (brief) deal.brief = brief;
        // Initialize empty creativeHistory array
        deal.creativeHistory = [];

        // Mark as demo if in demo mode
        if (config.demoMode) {
            (deal as any).isDemo = true;
        }

        if (scheduledTime) {
            deal.scheduledTime = Timestamp.fromDate(new Date(scheduledTime));
        }

        await db.collection(collections.deals).doc(deal.id).set(deal);

        // Notify the other party
        const notifyUserId = sourceType === 'listing' ? channelOwnerId : advertiserId;
        const notifyUserDoc = await db.collection(collections.users).doc(notifyUserId).get();

        if (notifyUserDoc.exists) {
            const notifyUser = notifyUserDoc.data() as User;
            const demoPrefix = config.demoMode ? '🧪 [DEMO] ' : '';
            let message: string;
            if (sourceType === 'listing') {
                // Advertiser paid immediately - notify channel owner about paid deal
                message = `${demoPrefix}💰 <b>New Paid Ad Deal!</b>\n\nAn advertiser is paying ${amount} TON to advertise on @${channel.username || channel.title}.\n\nPayment is being processed. You'll be notified to submit your creative once confirmed.`;
            } else {
                message = `${demoPrefix}🤝 <b>Deal Accepted!</b>\n\n@${channel.username || channel.title} has accepted your ad request.`;
            }

            await sendNotification(
                notifyUser.telegramId,
                message,
                [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${deal.id}` }]
            );
        }

        res.json({
            success: true,
            data: {
                ...deal,
                paymentAddress: escrowAddress,
                paymentAmount: amount,
                isDemo: config.demoMode,
                demoMessage: config.demoMode ? 'Demo mode: Payment simulated, proceed to creative submission' : undefined,
            },
        });
    } catch (error: any) {
        console.error('Error creating deal:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error while creating deal',
        });
    }
}

// Get deal by ID
export async function getDeal(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Check if user is part of the deal
    if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    // Get related data
    const [channelDoc, advertiserDoc, ownerDoc] = await Promise.all([
        db.collection(collections.channels).doc(deal.channelId).get(),
        db.collection(collections.users).doc(deal.advertiserId).get(),
        db.collection(collections.users).doc(deal.channelOwnerId).get(),
    ]);

    // Get escrow balance
    const escrowBalance = await getWalletBalance(deal.escrowWalletAddress);

    res.json({
        success: true,
        data: {
            ...deal,
            escrowBalance,
            channel: channelDoc.exists ? channelDoc.data() : null,
            advertiser: advertiserDoc.exists ? {
                id: (advertiserDoc.data() as User).id,
                username: (advertiserDoc.data() as User).username,
                firstName: (advertiserDoc.data() as User).firstName,
            } : null,
            channelOwner: ownerDoc.exists ? {
                id: (ownerDoc.data() as User).id,
                username: (ownerDoc.data() as User).username,
                firstName: (ownerDoc.data() as User).firstName,
            } : null,
        },
    });
}

// Manually check payment status for a deal
export async function checkPaymentStatus(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    // Advertiser can pass their wallet address for future refunds
    const { advertiserWalletAddress } = req.body || {};

    try {
        const dealDoc = await db.collection(collections.deals).doc(dealId).get();
        if (!dealDoc.exists) {
            res.status(404).json({ success: false, error: 'Deal not found' });
            return;
        }

        const deal = dealDoc.data() as Deal;

        // Check if user is part of the deal
        if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
            res.status(403).json({ success: false, error: 'Not authorized' });
            return;
        }

        if (deal.status !== 'pending_payment') {
            res.json({
                success: true,
                data: { status: deal.status, message: 'Deal is not in pending_payment status' },
            });
            return;
        }

        // Check payment on blockchain
        const payment = await checkIncomingPayment(
            deal.escrowWalletAddress,
            deal.amount,
            deal.createdAt.toMillis()
        );

        // Also check balance directly
        const balance = await getWalletBalance(deal.escrowWalletAddress);

        if (payment.received || balance >= deal.amount * 0.99) {
            const receivedAmount = payment.received ? payment.amount : balance;

            // Save advertiser's wallet address for future refunds
            const updateData: any = {
                status: 'creative_pending',
                escrowBalance: receivedAmount,
                lastActivityAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            };
            if (advertiserWalletAddress) {
                updateData.advertiserWalletAddress = advertiserWalletAddress;
            }
            await dealDoc.ref.update(updateData);

            // Notify channel owner
            const channelOwner = await db.collection(collections.users).doc(deal.channelOwnerId).get();
            if (channelOwner.exists) {
                const ownerUser = channelOwner.data() as User;
                await sendNotification(
                    ownerUser.telegramId,
                    `💰 <b>Payment Received!</b>\n\nDeal #${deal.id.slice(0, 8)} has received payment of ${receivedAmount} TON.\n\nPlease submit your creative for review.`,
                    [{ text: '📝 Submit Creative', url: `${config.appUrl}/deals/${deal.id}` }]
                );
            }

            res.json({
                success: true,
                data: {
                    status: 'creative_pending',
                    paymentReceived: true,
                    amount: receivedAmount,
                    balance,
                    message: 'Payment confirmed! Deal advanced to creative submission.',
                },
            });
        } else {
            res.json({
                success: true,
                data: {
                    status: 'pending_payment',
                    paymentReceived: false,
                    balance,
                    escrowAddress: deal.escrowWalletAddress,
                    expectedAmount: deal.amount,
                    message: balance > 0
                        ? `Balance detected: ${balance} TON, but less than required ${deal.amount} TON`
                        : 'No payment detected yet. Please wait a few minutes after sending.',
                },
            });
        }
    } catch (error: any) {
        console.error('Error checking payment:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check payment status',
        });
    }
}

// List user's deals
export async function getMyDeals(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { role, status, limit = 20, offset = 0 } = req.query;

    let query: FirebaseFirestore.Query = db.collection(collections.deals);

    // Helper function to populate channel data for deals
    const populateChannelData = async (deals: Deal[]): Promise<Deal[]> => {
        // Get unique channel IDs
        const channelIds = [...new Set(deals.map(d => d.channelId).filter(Boolean))];

        if (channelIds.length === 0) return deals;

        // Fetch all channels in parallel
        const channelDocs = await Promise.all(
            channelIds.map(id => db.collection(collections.channels).doc(id).get())
        );

        // Create a map of channel data
        const channelMap = new Map<string, any>();
        channelDocs.forEach(doc => {
            if (doc.exists) {
                const data = doc.data() as Channel;
                channelMap.set(doc.id, {
                    id: doc.id,
                    title: data.title,
                    username: data.username,
                    photoUrl: data.photoUrl,
                });
            }
        });

        // Attach channel data to each deal
        return deals.map(deal => ({
            ...deal,
            channel: channelMap.get(deal.channelId) || null,
        }));
    };

    // Filter by role
    if (role === 'advertiser') {
        query = query.where('advertiserId', '==', user.id);
    } else if (role === 'channel_owner') {
        query = query.where('channelOwnerId', '==', user.id);
    } else {
        // Get deals where user is either party (need to do two queries)
        const [advertiserDeals, ownerDeals] = await Promise.all([
            db.collection(collections.deals)
                .where('advertiserId', '==', user.id)
                .orderBy('createdAt', 'desc')
                .get(),
            db.collection(collections.deals)
                .where('channelOwnerId', '==', user.id)
                .orderBy('createdAt', 'desc')
                .get(),
        ]);

        // Merge and dedupe
        const dealsMap = new Map<string, Deal>();
        advertiserDeals.docs.forEach(doc => dealsMap.set(doc.id, doc.data() as Deal));
        ownerDeals.docs.forEach(doc => dealsMap.set(doc.id, doc.data() as Deal));

        let deals = Array.from(dealsMap.values());

        // Sort by createdAt desc
        deals.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

        // Filter by status if provided
        if (status) {
            deals = deals.filter(d => d.status === status);
        }

        // Pagination
        const start = parseInt(offset as string);
        const end = start + parseInt(limit as string);
        deals = deals.slice(start, end);

        // Populate channel data
        const dealsWithChannels = await populateChannelData(deals);

        res.json({
            success: true,
            data: dealsWithChannels,
            pagination: {
                limit: parseInt(limit as string),
                offset: start,
                hasMore: end < dealsMap.size,
            },
        });
        return;
    }

    // Filter by status
    if (status) {
        query = query.where('status', '==', status);
    }

    query = query.orderBy('createdAt', 'desc');
    query = query.limit(parseInt(limit as string)).offset(parseInt(offset as string));

    const snapshot = await query.get();
    let deals = snapshot.docs.map(doc => doc.data() as Deal);

    // Populate channel data
    const dealsWithChannels = await populateChannelData(deals);

    res.json({
        success: true,
        data: dealsWithChannels,
        pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: deals.length === parseInt(limit as string),
        },
    });
}

// Update deal status
export async function updateDealStatus(req: Request, res: Response): Promise<void> {
    try {
        const user = (req as any).user as User;
        const { dealId } = req.params;
        const { status: newStatus, creative, scheduledTime } = req.body;

        const dealDoc = await db.collection(collections.deals).doc(dealId).get();

        if (!dealDoc.exists) {
            res.status(404).json({ success: false, error: 'Deal not found' });
            return;
        }

        const deal = dealDoc.data() as Deal;

        // Check if user is part of the deal
        const isAdvertiser = deal.advertiserId === user.id;
        const isChannelOwner = deal.channelOwnerId === user.id;

        if (!isAdvertiser && !isChannelOwner) {
            res.status(403).json({ success: false, error: 'Not authorized' });
            return;
        }

        // Validate status transition
        const allowedTransitions = dealStatusTransitions[deal.status] || [];

        if (newStatus && !allowedTransitions.includes(newStatus)) {
            res.status(400).json({
                success: false,
                error: `Cannot transition from ${deal.status} to ${newStatus}`,
            });
            return;
        }

        // Validate role-based permissions
        if (newStatus) {
            const canTransition = validateRoleTransition(
                deal.status,
                newStatus,
                isAdvertiser ? 'advertiser' : 'channel_owner'
            );

            if (!canTransition) {
                res.status(403).json({
                    success: false,
                    error: `You don't have permission to make this status change`,
                });
                return;
            }
        }

        // Re-verify channel admin status for important transitions
        if (isChannelOwner && ['creative_submitted', 'scheduled'].includes(newStatus)) {
            const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
            if (channelDoc.exists) {
                const channel = channelDoc.data() as Channel;
                const stillAdmin = await checkUserIsAdmin(channel.chatId, user.telegramId);
                if (!stillAdmin) {
                    res.status(403).json({
                        success: false,
                        error: 'You are no longer an admin of this channel',
                    });
                    return;
                }
            }
        }

        // Prepare updates
        const updates: Partial<Deal> = {
            lastActivityAt: Timestamp.now(),
            autoCancelAfter: hoursFromNow(config.escrowTimeoutHours),
            updatedAt: Timestamp.now(),
        };

        if (newStatus) {
            updates.status = newStatus;
        }

        // Handle creative submission
        if (creative && newStatus === 'creative_submitted') {
            // Build creative object without undefined values (Firestore doesn't allow undefined)
            const creativeData: any = {
                text: creative.text,
                submittedAt: Timestamp.now(),
            };
            if (creative.mediaUrls && creative.mediaUrls.length > 0) {
                creativeData.mediaUrls = creative.mediaUrls;
            }
            // Support single mediaUrl from new UI
            if (creative.mediaUrl) {
                creativeData.mediaUrl = creative.mediaUrl;
                creativeData.mediaUrls = [creative.mediaUrl];
            }
            if (creative.buttons && creative.buttons.length > 0) {
                creativeData.buttons = creative.buttons;
            }
            updates.creative = creativeData;

            // Store scheduledTime from creative submission if provided
            if (scheduledTime) {
                updates.scheduledTime = Timestamp.fromDate(new Date(scheduledTime));
            }

            // Store in creative history
            const creativeSubmission: CreativeSubmission = {
                id: uuidv4(),
                text: creative.text,
                mediaUrls: creative.mediaUrl ? [creative.mediaUrl] : (creative.mediaUrls || []),
                buttons: creative.buttons || [],
                submittedAt: Timestamp.now(),
                status: 'pending',
            };
            const existingHistory = deal.creativeHistory || [];
            updates.creativeHistory = [...existingHistory, creativeSubmission];
        }

        // Handle creative approval
        if (newStatus === 'creative_approved' && deal.creative) {
            updates.creative = {
                ...deal.creative,
                approvedAt: Timestamp.now(),
            };

            // Update the latest creative submission status to approved
            if (deal.creativeHistory && deal.creativeHistory.length > 0) {
                const updatedHistory = deal.creativeHistory.map((submission, index, arr) => {
                    if (index === arr.length - 1) {
                        return { ...submission, status: 'approved' as const };
                    }
                    return submission;
                });
                updates.creativeHistory = updatedHistory;
            }
        }

        // Handle scheduling
        if (scheduledTime && newStatus === 'scheduled') {
            updates.scheduledTime = Timestamp.fromDate(new Date(scheduledTime));
        }

        await dealDoc.ref.update(updates);

        // Send notification
        const otherUserId = isAdvertiser ? deal.channelOwnerId : deal.advertiserId;
        const otherUserDoc = await db.collection(collections.users).doc(otherUserId).get();

        if (otherUserDoc.exists && newStatus) {
            const otherUser = otherUserDoc.data() as User;
            const statusMessages: Record<string, string> = {
                creative_submitted: '📝 New creative has been submitted for your review.',
                creative_approved: '✅ Your creative has been approved! Ready to schedule.',
                creative_pending: '🔄 Changes requested on the creative.',
                scheduled: '📅 The ad has been scheduled for posting.',
                cancelled: '❌ The deal has been cancelled.',
                disputed: '⚠️ A dispute has been raised.',
            };

            if (statusMessages[newStatus]) {
                await sendNotification(
                    otherUser.telegramId,
                    `<b>Deal #${deal.id.slice(0, 8)} Update</b>\n\n${statusMessages[newStatus]}`,
                    [{ text: '👁 View Deal', url: `${config.appUrl}/deals/${deal.id}` }]
                );
            }
        }

        // Notify admins when a dispute is raised
        if (newStatus === 'disputed') {
            const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
            const channel = channelDoc.exists ? channelDoc.data() as Channel : null;

            const advertiserDoc = await db.collection(collections.users).doc(deal.advertiserId).get();
            const advertiser = advertiserDoc.exists ? advertiserDoc.data() as User : null;

            const channelOwnerDoc = await db.collection(collections.users).doc(deal.channelOwnerId).get();
            const channelOwner = channelOwnerDoc.exists ? channelOwnerDoc.data() as User : null;

            for (const adminId of config.adminTelegramIds) {
                await sendNotification(
                    adminId,
                    `🚨 <b>New Dispute Requires Attention</b>\n\n` +
                    `<b>Deal:</b> #${deal.id.slice(0, 8)}\n` +
                    `<b>Amount:</b> ${deal.amount} TON\n` +
                    `<b>Reason:</b> Manual dispute raised by ${isAdvertiser ? 'advertiser' : 'channel owner'}\n\n` +
                    `<b>Advertiser:</b> ${advertiser?.username ? '@' + advertiser.username : advertiser?.firstName || 'Unknown'}\n` +
                    `<b>Channel Owner:</b> ${channelOwner?.username ? '@' + channelOwner.username : channelOwner?.firstName || 'Unknown'}\n` +
                    `<b>Channel:</b> ${channel?.username ? '@' + channel.username : channel?.title || 'Unknown'}\n\n` +
                    `Please review and resolve this dispute.`,
                    [{ text: '⚖️ Review Dispute', url: `${config.appUrl}/admin` }]
                );
            }
        }

        const updatedDoc = await dealDoc.ref.get();

        res.json({
            success: true,
            data: updatedDoc.data(),
        });
    } catch (error: any) {
        console.error('Error updating deal status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update deal status',
        });
    }
}

// Helper to validate role-based transitions
function validateRoleTransition(
    currentStatus: DealStatus,
    newStatus: DealStatus,
    role: 'advertiser' | 'channel_owner'
): boolean {
    const advertiserTransitions: Partial<Record<DealStatus, DealStatus[]>> = {
        creative_submitted: ['creative_approved', 'creative_pending', 'creative_revision', 'scheduled'],
        posted: ['disputed'],
        pending_acceptance: ['cancelled'],
        pending_payment: ['cancelled'],
        creative_pending: ['cancelled'],
        creative_revision: ['cancelled'],
        payment_received: ['cancelled'],
    };

    const ownerTransitions: Partial<Record<DealStatus, DealStatus[]>> = {
        pending_acceptance: ['pending_payment', 'cancelled'],
        creative_pending: ['creative_submitted'],
        creative_revision: ['creative_submitted'],  // Allow submitting revised creative
        creative_approved: ['scheduled'],
        pending_payment: ['cancelled'],
        payment_received: ['cancelled'],
    };

    const transitions = role === 'advertiser' ? advertiserTransitions : ownerTransitions;

    return transitions[currentStatus]?.includes(newStatus) || false;
}

// Get deal messages
export async function getDealMessages(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { limit = 50, before } = req.query;

    // Verify user is part of the deal
    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    let query = db.collection(collections.deals)
        .doc(dealId)
        .collection(collections.messages)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit as string));

    if (before) {
        query = query.startAfter(Timestamp.fromDate(new Date(before as string)));
    }

    const snapshot = await query.get();
    const messages = snapshot.docs.map(doc => doc.data() as Message);

    res.json({
        success: true,
        data: messages.reverse(), // Return in chronological order
    });
}

// Send deal message
export async function sendDealMessage(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { text, type = 'text' } = req.body;

    if (!text) {
        res.status(400).json({ success: false, error: 'Message text is required' });
        return;
    }

    // Verify user is part of the deal
    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    if (deal.advertiserId !== user.id && deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    const message: Message = {
        id: uuidv4(),
        dealId,
        senderId: user.id,
        senderRole: deal.advertiserId === user.id ? 'advertiser' : 'channel_owner',
        text,
        type,
        createdAt: Timestamp.now(),
    };

    await db.collection(collections.deals)
        .doc(dealId)
        .collection(collections.messages)
        .doc(message.id)
        .set(message);

    // Update deal activity
    await dealDoc.ref.update({
        lastActivityAt: Timestamp.now(),
        autoCancelAfter: hoursFromNow(config.escrowTimeoutHours),
    });

    // Notify other party via Telegram bot (not mini app notification)
    const otherUserId = deal.advertiserId === user.id ? deal.channelOwnerId : deal.advertiserId;
    const otherUserDoc = await db.collection(collections.users).doc(otherUserId).get();

    if (otherUserDoc.exists) {
        const otherUser = otherUserDoc.data() as User;
        await sendNotification(
            otherUser.telegramId,
            `💬 <b>New Message</b>\n\nDeal #${deal.id.slice(0, 8)}\n\n${user.firstName}: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`,
            [{ text: '💬 Reply', url: `${config.appUrl}/deals/${deal.id}` }]
        );
    }

    res.json({
        success: true,
        data: message,
    });
}

// Get payment info for a deal
export async function getPaymentInfo(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();

    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Only advertiser can see payment info
    if (deal.advertiserId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    const escrowBalance = await getWalletBalance(deal.escrowWalletAddress);

    res.json({
        success: true,
        data: {
            address: deal.escrowWalletAddress,
            amount: deal.amount,
            currentBalance: escrowBalance,
            isPaid: escrowBalance >= deal.amount * 0.99,
            status: deal.status,
        },
    });
}

// Channel owner accepts a deal
export async function acceptDeal(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();
    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Only channel owner can accept
    if (deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Only channel owner can accept this deal' });
        return;
    }

    // Can only accept from pending_acceptance
    if (deal.status !== 'pending_acceptance') {
        res.status(400).json({ success: false, error: `Cannot accept deal in ${deal.status} status` });
        return;
    }

    // Re-verify user is still admin on Telegram (critical for financial operations)
    const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
    if (channelDoc.exists) {
        const channel = channelDoc.data() as Channel;
        const stillAdmin = await checkUserIsAdmin(channel.chatId, user.telegramId);
        if (!stillAdmin) {
            res.status(403).json({
                success: false,
                error: 'You are no longer an admin of this channel on Telegram',
            });
            return;
        }
    }

    // Update to pending_payment (or creative_pending in demo mode)
    const newStatus = config.demoMode ? 'creative_pending' : 'pending_payment';

    await dealDoc.ref.update({
        status: newStatus,
        escrowBalance: config.demoMode ? deal.amount : 0,
        lastActivityAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });

    // Notify advertiser
    const advertiserDoc = await db.collection(collections.users).doc(deal.advertiserId).get();
    if (advertiserDoc.exists) {
        const advertiser = advertiserDoc.data() as User;
        const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
        const channel = channelDoc.exists ? channelDoc.data() as Channel : null;

        await sendNotification(
            advertiser.telegramId,
            `✅ <b>Deal Accepted!</b>\n\nChannel: ${channel?.title || 'Unknown'}\nAmount: ${deal.amount} TON\n\n${config.demoMode ? '🧪 Demo mode: Payment skipped' : 'Please proceed with payment.'}`,
            [{ text: '💳 View Deal', url: `${config.appUrl}/deals/${deal.id}` }]
        );
    }

    res.json({ success: true, data: { ...deal, status: newStatus } });
}

// Channel owner rejects a deal
export async function rejectDeal(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { reason } = req.body;

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();
    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Only channel owner can reject
    if (deal.channelOwnerId !== user.id) {
        res.status(403).json({ success: false, error: 'Only channel owner can reject this deal' });
        return;
    }

    // Can only reject from pending_acceptance
    if (deal.status !== 'pending_acceptance') {
        res.status(400).json({ success: false, error: `Cannot reject deal in ${deal.status} status` });
        return;
    }

    // Re-verify user is still admin on Telegram
    const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
    if (channelDoc.exists) {
        const channel = channelDoc.data() as Channel;
        const stillAdmin = await checkUserIsAdmin(channel.chatId, user.telegramId);
        if (!stillAdmin) {
            res.status(403).json({
                success: false,
                error: 'You are no longer an admin of this channel on Telegram',
            });
            return;
        }
    }

    await dealDoc.ref.update({
        status: 'cancelled',
        lastActivityAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });

    // Notify advertiser
    const advertiserDoc = await db.collection(collections.users).doc(deal.advertiserId).get();
    if (advertiserDoc.exists) {
        const advertiser = advertiserDoc.data() as User;
        const channelDoc = await db.collection(collections.channels).doc(deal.channelId).get();
        const channel = channelDoc.exists ? channelDoc.data() as Channel : null;

        await sendNotification(
            advertiser.telegramId,
            `❌ <b>Deal Rejected</b>\n\nChannel: ${channel?.title || 'Unknown'}\n${reason ? `Reason: ${reason}` : ''}`,
            []
        );
    }

    res.json({ success: true, data: { ...deal, status: 'cancelled' } });
}

// Advertiser requests creative revision
export async function requestCreativeRevision(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { dealId } = req.params;
    const { feedback } = req.body;

    if (!feedback) {
        res.status(400).json({ success: false, error: 'Feedback is required to request revision' });
        return;
    }

    const dealDoc = await db.collection(collections.deals).doc(dealId).get();
    if (!dealDoc.exists) {
        res.status(404).json({ success: false, error: 'Deal not found' });
        return;
    }

    const deal = dealDoc.data() as Deal;

    // Only advertiser can request revision
    if (deal.advertiserId !== user.id) {
        res.status(403).json({ success: false, error: 'Only advertiser can request revision' });
        return;
    }

    // Can only request revision from creative_submitted
    if (deal.status !== 'creative_submitted') {
        res.status(400).json({ success: false, error: 'Creative must be submitted first' });
        return;
    }

    // Update the latest creative submission status to rejected
    const updatedHistory = (deal.creativeHistory || []).map((submission, index, arr) => {
        if (index === arr.length - 1) {
            return { ...submission, status: 'rejected' as const, feedback };
        }
        return submission;
    });

    await dealDoc.ref.update({
        status: 'creative_revision',
        creativeHistory: updatedHistory,
        lastActivityAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });

    // Notify channel owner
    const ownerDoc = await db.collection(collections.users).doc(deal.channelOwnerId).get();
    if (ownerDoc.exists) {
        const owner = ownerDoc.data() as User;
        await sendNotification(
            owner.telegramId,
            `✏️ <b>Creative Revision Requested</b>\n\nDeal #${deal.id.slice(0, 8)}\n\nFeedback: ${feedback}\n\nPlease submit a revised version.`,
            [{ text: '✏️ Edit Creative', url: `${config.appUrl}/deals/${deal.id}` }]
        );
    }

    res.json({ success: true, data: { ...deal, status: 'creative_revision' } });
}
