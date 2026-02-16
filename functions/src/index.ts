// Main entry point for Firebase Cloud Functions

import * as functions from 'firebase-functions';
import { config } from './config';

// Bot handler
import { handleWebhook } from './bot';

// API handlers
import { authenticateUser, getProfile, updateProfile, getUserById, getWalletInfo } from './api/users';
import {
    registerChannel,
    getChannel,
    listChannels,
    getMyChannels,
    updateChannel,
    refreshChannelStats,
    verifyBotAdmin,
    getChannelAdminsHandler,
    syncChannelAdmins,
    getChannelGrowth,
} from './api/channels';
import {
    createAdRequest,
    getAdRequest,
    listAdRequests,
    getMyAdRequests,
    updateAdRequest,
    applyToRequest,
    getApplicants,
} from './api/requests';
import {
    createDeal,
    getDeal,
    getMyDeals,
    updateDealStatus,
    getDealMessages,
    sendDealMessage,
    getPaymentInfo,
    acceptDeal,
    rejectDeal,
    requestCreativeRevision,
    checkPaymentStatus,
} from './api/deals';
import { uploadFile } from './api/upload';

// Scheduler functions
import {
    checkPendingPayments,
    checkScheduledPosts,
    verifyPostedContent,
    handleTimeouts,
    updateChannelStats,
} from './services/scheduler';

// Initialize Express app for API
import express = require('express');
import cors = require('cors');

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bot info - returns bot username for deep links
let cachedBotUsername: string | null = null;
app.get('/bot-info', async (req, res) => {
    try {
        if (!cachedBotUsername) {
            const { Telegraf } = require('telegraf');
            const bot = new Telegraf(config.telegramBotToken);
            const me = await bot.telegram.getMe();
            cachedBotUsername = me.username;
        }
        res.json({ success: true, data: { username: cachedBotUsername } });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Auth middleware wrapper
const withAuth = (handler: any) => async (req: express.Request, res: express.Response) => {
    await authenticateUser(req, res, () => handler(req, res));
};

// User routes
app.get('/users/me', withAuth(getProfile));
app.put('/users/me', withAuth(updateProfile));
app.get('/users/:userId', withAuth(getUserById));
app.get('/wallet', withAuth(getWalletInfo));

// Channel routes
app.post('/channels', withAuth(registerChannel));
app.get('/channels', withAuth(listChannels));
app.get('/channels/mine', withAuth(getMyChannels));
app.get('/channels/:channelId', withAuth(getChannel));
app.put('/channels/:channelId', withAuth(updateChannel));
app.post('/channels/:channelId/refresh', withAuth(refreshChannelStats));
app.get('/channels/:channelId/verify-bot', withAuth(verifyBotAdmin));
app.get('/channels/:channelId/admins', withAuth(getChannelAdminsHandler));
app.post('/channels/:channelId/admins/sync', withAuth(syncChannelAdmins));
app.get('/channels/:channelId/growth', withAuth(getChannelGrowth));

// Ad Request routes
app.post('/requests', withAuth(createAdRequest));
app.get('/requests', withAuth(listAdRequests));
app.get('/requests/mine', withAuth(getMyAdRequests));
app.get('/requests/:requestId', withAuth(getAdRequest));
app.put('/requests/:requestId', withAuth(updateAdRequest));
app.post('/requests/:requestId/apply', withAuth(applyToRequest));
app.get('/requests/:requestId/applicants', withAuth(getApplicants));

// Deal routes
app.post('/deals', withAuth(createDeal));
app.get('/deals', withAuth(getMyDeals));
app.get('/deals/:dealId', withAuth(getDeal));
app.put('/deals/:dealId/status', withAuth(updateDealStatus));
app.post('/deals/:dealId/accept', withAuth(acceptDeal));
app.post('/deals/:dealId/reject', withAuth(rejectDeal));
app.post('/deals/:dealId/request-revision', withAuth(requestCreativeRevision));
app.get('/deals/:dealId/messages', withAuth(getDealMessages));
app.post('/deals/:dealId/messages', withAuth(sendDealMessage));
app.get('/deals/:dealId/payment', withAuth(getPaymentInfo));
app.post('/deals/:dealId/check-payment', withAuth(checkPaymentStatus));


// Upload route
app.post('/upload', withAuth(uploadFile));

// Admin routes
import adminRouter from './api/admin';

// Create auth middleware for admin routes
const adminAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    authenticateUser(req, res, () => {
        next();
    });
};

app.use('/admin', adminAuthMiddleware, adminRouter);

// 404 handler - must return JSON
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler - always return JSON
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

// Export API function
export const api = functions.https.onRequest(app);

// Export Telegram webhook function
export const telegramWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    await handleWebhook(req, res);
});

// Scheduled functions

// Check for payments every 2 minutes
export const scheduledPaymentCheck = functions.pubsub
    .schedule('every 2 minutes')
    .onRun(async () => {
        await checkPendingPayments();
    });

// Check for scheduled posts every minute
export const scheduledPostCheck = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async () => {
        await checkScheduledPosts();
    });

// Verify posted content every 10 minutes
export const scheduledVerification = functions.pubsub
    .schedule('every 10 minutes')
    .onRun(async () => {
        await verifyPostedContent();
    });

// Handle timeouts every hour
export const scheduledTimeoutCheck = functions.pubsub
    .schedule('every 1 hours')
    .onRun(async () => {
        await handleTimeouts();
    });

// Update channel stats every 6 hours
export const scheduledStatsUpdate = functions.pubsub
    .schedule('every 6 hours')
    .onRun(async () => {
        await updateChannelStats();
    });
