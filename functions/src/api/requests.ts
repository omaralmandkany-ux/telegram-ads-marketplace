// Ad Requests API - handles advertiser campaigns and applications

import { Request, Response } from 'express';
import { db, Timestamp, hoursFromNow, storage } from '../firebase';
import { collections, config } from '../config';
import { AdRequest, User, Channel, ApiResponse } from '../types';
import { sendNotification } from '../services/telegram';
import { v4 as uuidv4 } from 'uuid';

// Helper function to upload base64 image to Firebase Storage
async function uploadImageToStorage(base64Data: string, requestId: string): Promise<string | null> {
    try {
        // Extract the actual base64 data (remove data:image/xxx;base64, prefix)
        const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
            console.error('Invalid base64 image format');
            return null;
        }

        const imageFormat = matches[1];
        const base64ImageData = matches[2];
        const imageBuffer = Buffer.from(base64ImageData, 'base64');

        const bucket = storage.bucket();
        const fileName = `ad-requests/${requestId}/image.${imageFormat}`;
        const file = bucket.file(fileName);

        await file.save(imageBuffer, {
            metadata: {
                contentType: `image/${imageFormat}`,
            },
        });

        // Make the file publicly accessible
        await file.makePublic();

        // Get the public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        return publicUrl;
    } catch (error) {
        console.error('Error uploading image:', error);
        return null;
    }
}

// Create a new ad request
export async function createAdRequest(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const {
        title,
        description,
        budget,
        targetAudience,
        preferredFormat,
        requirements,
        minSubscribers,
        maxSubscribers,
        languages,
        categories,
        expiresInDays,
        imageBase64,
    } = req.body;

    if (!title || !description || !budget) {
        res.status(400).json({
            success: false,
            error: 'Title, description, and budget are required',
        });
        return;
    }

    const requestId = uuidv4();

    // Upload image if provided
    let imageUrl: string | null = null;
    if (imageBase64) {
        imageUrl = await uploadImageToStorage(imageBase64, requestId);
    }

    const adRequest: AdRequest = {
        id: requestId,
        advertiserId: user.id,
        title,
        description,
        budget: {
            min: budget.min || 0,
            max: budget.max || budget.min || 0,
        },
        targetAudience: targetAudience || '',
        preferredFormat: preferredFormat || 'post',
        requirements: requirements || '',
        minSubscribers: minSubscribers || 0,
        maxSubscribers: maxSubscribers || 0,
        languages: languages || [],
        categories: categories || [],
        status: 'active',
        applicants: [],
        createdAt: Timestamp.now(),
        expiresAt: expiresInDays ? hoursFromNow(expiresInDays * 24) : null,
        imageUrl: imageUrl,
    };

    // Filter out any remaining undefined values to prevent Firestore errors
    const cleanedAdRequest = Object.fromEntries(
        Object.entries(adRequest).filter(([_, v]) => v !== undefined)
    ) as AdRequest;

    await db.collection(collections.adRequests).doc(adRequest.id).set(cleanedAdRequest);

    res.json({
        success: true,
        data: adRequest,
    });
}

// Get ad request by ID
export async function getAdRequest(req: Request, res: Response): Promise<void> {
    const { requestId } = req.params;

    const requestDoc = await db.collection(collections.adRequests).doc(requestId).get();

    if (!requestDoc.exists) {
        res.status(404).json({ success: false, error: 'Ad request not found' });
        return;
    }

    const adRequest = requestDoc.data() as AdRequest;

    // Get advertiser info
    const advertiserDoc = await db.collection(collections.users).doc(adRequest.advertiserId).get();
    const advertiser = advertiserDoc.exists ? advertiserDoc.data() as User : null;

    res.json({
        success: true,
        data: {
            ...adRequest,
            advertiser: advertiser ? {
                id: advertiser.id,
                username: advertiser.username,
                firstName: advertiser.firstName,
            } : null,
        },
    });
}

// List ad requests with filters
export async function listAdRequests(req: Request, res: Response): Promise<void> {
    const {
        minBudget,
        maxBudget,
        format,
        status = 'active',
        search,
        limit = 20,
        offset = 0,
    } = req.query;

    let query = db.collection(collections.adRequests)
        .where('status', '==', status)
        .orderBy('createdAt', 'desc');

    // Pagination
    query = query.limit(parseInt(limit as string)).offset(parseInt(offset as string));

    const snapshot = await query.get();

    let requests = snapshot.docs.map(doc => doc.data() as AdRequest);

    // Client-side filtering
    if (minBudget) {
        const min = parseFloat(minBudget as string);
        requests = requests.filter(r => r.budget.max >= min);
    }

    if (maxBudget) {
        const max = parseFloat(maxBudget as string);
        requests = requests.filter(r => r.budget.min <= max);
    }

    if (format) {
        requests = requests.filter(r => r.preferredFormat === format);
    }

    if (search) {
        const searchLower = (search as string).toLowerCase();
        requests = requests.filter(r =>
            r.title.toLowerCase().includes(searchLower) ||
            r.description.toLowerCase().includes(searchLower)
        );
    }

    // Get advertiser info for each request
    const requestsWithAdvertiser = await Promise.all(
        requests.map(async (request) => {
            const advertiserDoc = await db.collection(collections.users).doc(request.advertiserId).get();
            const advertiser = advertiserDoc.exists ? advertiserDoc.data() as User : null;
            return {
                ...request,
                advertiser: advertiser ? {
                    id: advertiser.id,
                    username: advertiser.username,
                    firstName: advertiser.firstName,
                } : null,
            };
        })
    );

    res.json({
        success: true,
        data: requestsWithAdvertiser,
        pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: requests.length === parseInt(limit as string),
        },
    });
}

// Get user's own ad requests
export async function getMyAdRequests(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;

    const snapshot = await db.collection(collections.adRequests)
        .where('advertiserId', '==', user.id)
        .orderBy('createdAt', 'desc')
        .get();

    const requests = snapshot.docs.map(doc => doc.data() as AdRequest);

    res.json({
        success: true,
        data: requests,
    });
}

// Update ad request
export async function updateAdRequest(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { requestId } = req.params;
    const updates = req.body;

    const requestDoc = await db.collection(collections.adRequests).doc(requestId).get();

    if (!requestDoc.exists) {
        res.status(404).json({ success: false, error: 'Ad request not found' });
        return;
    }

    const adRequest = requestDoc.data() as AdRequest;

    if (adRequest.advertiserId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    // Only allow updating certain fields
    const allowedUpdates: Partial<AdRequest> = {};

    if (updates.title) allowedUpdates.title = updates.title;
    if (updates.description) allowedUpdates.description = updates.description;
    if (updates.budget) allowedUpdates.budget = updates.budget;
    if (updates.targetAudience !== undefined) allowedUpdates.targetAudience = updates.targetAudience;
    if (updates.requirements !== undefined) allowedUpdates.requirements = updates.requirements;
    if (updates.status && ['active', 'paused', 'completed', 'cancelled'].includes(updates.status)) {
        allowedUpdates.status = updates.status;
    }

    await requestDoc.ref.update(allowedUpdates);

    const updatedDoc = await requestDoc.ref.get();

    res.json({
        success: true,
        data: updatedDoc.data(),
    });
}

// Apply to an ad request (as channel owner)
export async function applyToRequest(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { requestId } = req.params;
    const { channelId, proposedPrice, message } = req.body;

    if (!channelId) {
        res.status(400).json({ success: false, error: 'Channel ID is required' });
        return;
    }

    // Get the ad request
    const requestDoc = await db.collection(collections.adRequests).doc(requestId).get();

    if (!requestDoc.exists) {
        res.status(404).json({ success: false, error: 'Ad request not found' });
        return;
    }

    const adRequest = requestDoc.data() as AdRequest;

    if (adRequest.status !== 'active') {
        res.status(400).json({ success: false, error: 'This request is no longer active' });
        return;
    }

    // Check if channel exists and user is admin
    const channelDoc = await db.collection(collections.channels).doc(channelId).get();

    if (!channelDoc.exists) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
    }

    const channel = channelDoc.data() as Channel;

    if (!channel.admins.includes(user.id)) {
        res.status(403).json({ success: false, error: 'You are not an admin of this channel' });
        return;
    }

    // Check if already applied
    if (adRequest.applicants.includes(channelId)) {
        res.status(400).json({ success: false, error: 'You have already applied with this channel' });
        return;
    }

    // Add to applicants
    await requestDoc.ref.update({
        applicants: [...adRequest.applicants, channelId],
    });

    // Notify advertiser
    const advertiserDoc = await db.collection(collections.users).doc(adRequest.advertiserId).get();
    if (advertiserDoc.exists) {
        const advertiser = advertiserDoc.data() as User;
        await sendNotification(
            advertiser.telegramId,
            `📬 <b>New Application!</b>\n\n@${channel.username || channel.title} has applied to your ad request "${adRequest.title}".\n\n${proposedPrice ? `Proposed price: ${proposedPrice} TON` : ''}${message ? `\n\nMessage: ${message}` : ''}`,
            [{ text: '👁 View Request', url: `${config.appUrl}/requests/${requestId}` }]
        );
    }

    res.json({
        success: true,
        message: 'Application submitted successfully',
    });
}

// Get applicants for an ad request
export async function getApplicants(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { requestId } = req.params;

    const requestDoc = await db.collection(collections.adRequests).doc(requestId).get();

    if (!requestDoc.exists) {
        res.status(404).json({ success: false, error: 'Ad request not found' });
        return;
    }

    const adRequest = requestDoc.data() as AdRequest;

    if (adRequest.advertiserId !== user.id) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return;
    }

    // Get channel details for each applicant
    const channels = await Promise.all(
        adRequest.applicants.map(async (channelId) => {
            const channelDoc = await db.collection(collections.channels).doc(channelId).get();
            return channelDoc.exists ? channelDoc.data() as Channel : null;
        })
    );

    res.json({
        success: true,
        data: channels.filter(Boolean),
    });
}
