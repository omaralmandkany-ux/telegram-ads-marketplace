// Configuration and constants

// Secrets must come from the environment (functions/.env, which is git-ignored,
// or Firebase/Google Secret Manager). Never hardcode them in source code.
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Missing required environment variable ${name}. ` +
            `Set it in functions/.env (not committed) or as a Firebase secret before deploying.`
        );
    }
    return value;
}

export const config = {
    // Telegram (read lazily so a missing value fails with a clear error at use time)
    get telegramBotToken(): string {
        return requireEnv('TELEGRAM_BOT_TOKEN');
    },
    // Optional: secret_token passed to setWebhook; when set, webhook calls without it are rejected
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',

    // Firebase
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'telegramp2p-9a891',

    // TON
    tonNetwork: (process.env.TON_NETWORK || 'testnet') as 'mainnet' | 'testnet',
    tonApiKey: process.env.TON_API_KEY || '',
    tonHotWalletMnemonic: process.env.TON_HOT_WALLET_MNEMONIC || '',

    // App URL
    appUrl: process.env.APP_URL || 'https://telegramp2p-9a891.web.app',

    // Demo Mode - Skip real payments for testing
    // Set DEMO_MODE=true in environment to enable demo mode
    demoMode: process.env.DEMO_MODE === 'true', // Default to false for real payments
    demoBalance: 100, // Fake TON balance for demo

    // Admin settings
    adminTelegramIds: [523537718], // Admin Telegram user IDs for dispute resolution

    // Escrow settings
    escrowTimeoutHours: parseInt(process.env.ESCROW_TIMEOUT_HOURS || '48', 10),
    postVerificationHours: parseInt(process.env.POST_VERIFICATION_HOURS || '24', 10),
    postCheckIntervalMinutes: parseInt(process.env.POST_CHECK_INTERVAL_MINUTES || '10', 10),
};

// Deal status transitions - defines allowed transitions
export const dealStatusTransitions: Record<string, string[]> = {
    pending_acceptance: ['pending_payment', 'cancelled'],  // Channel owner accepts/rejects
    pending_payment: ['payment_received', 'cancelled'],
    payment_received: ['creative_pending', 'cancelled', 'refunded'],
    creative_pending: ['creative_submitted', 'cancelled', 'refunded'],
    creative_submitted: ['creative_approved', 'creative_revision', 'scheduled', 'cancelled', 'refunded'],
    creative_revision: ['creative_submitted', 'cancelled', 'refunded'],  // Owner submits revised creative
    creative_approved: ['scheduled', 'cancelled', 'refunded'],
    scheduled: ['posted', 'cancelled', 'refunded'],
    posted: ['verified', 'disputed'],
    verified: ['completed'],
    disputed: ['refunded', 'verified'],
    cancelled: [],
    completed: [],
    refunded: [],
};

// Valid deal status changes by role
export const dealStatusByRole = {
    advertiser: {
        canApprove: ['creative_approved'],
        canReject: ['creative_revision'],  // Request revisions
        canCancel: ['cancelled'],
        canDispute: ['disputed'],
    },
    channel_owner: {
        canAccept: ['pending_payment'],    // Accept deal
        canReject: ['cancelled'],          // Reject deal
        canSubmit: ['creative_submitted'],
        canSchedule: ['scheduled'],
        canCancel: ['cancelled'],
    },
    system: {
        canPost: ['posted'],
        canVerify: ['verified', 'completed'],
        canRefund: ['refunded'],
        canTimeout: ['cancelled'],
    },
};

// Ad formats configuration
export const adFormats = {
    post: {
        name: 'Post',
        description: 'Regular channel post',
        defaultDuration: '24h',
    },
    story: {
        name: 'Story',
        description: 'Channel story (24h visibility)',
        defaultDuration: '24h',
    },
    forward: {
        name: 'Forward/Repost',
        description: 'Forward from advertiser channel',
        defaultDuration: '24h',
    },
};

// Firestore collection names
export const collections = {
    users: 'users',
    channels: 'channels',
    adRequests: 'adRequests',
    deals: 'deals',
    messages: 'messages',
    wallets: 'wallets',
    admins: 'admins',
};

// TON amounts (in nanoTON)
export const tonAmounts = {
    minDealAmount: 0.1, // Minimum deal amount in TON
    platformFeePercent: 10, // Platform fee percentage
    platformWalletAddress: 'UQB77IA6xgd0N_ZthlLgBir0HykKosa5AmZyh3Q5o6edm3_6', // Platform wallet for fee collection
};
