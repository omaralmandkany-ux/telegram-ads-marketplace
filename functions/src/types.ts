// Type definitions for the Telegram Ads Marketplace

import { Timestamp } from 'firebase-admin/firestore';

// User types
export type UserRole = 'channel_owner' | 'advertiser' | 'both';

export interface User {
    id: string;
    telegramId: number;
    username?: string;
    firstName: string;
    lastName?: string;
    role: UserRole;
    walletAddress?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// Channel types
// Time-series data point for graphs
export interface GraphPoint {
    date: string; // ISO date string
    value: number;
}

// Joined/Left data point
export interface FollowerPoint {
    date: string;
    joined: number;
    left: number;
}

// Views & shares data point
export interface ViewSharePoint {
    date: string;
    views: number;
    shares: number;
}

// Recent post interaction
export interface PostInteraction {
    msgId: number;
    views: number;
    forwards: number;
}

export interface ChannelStats {
    subscribers: number;
    avgViews: number;
    avgReach: number;
    // Premium
    premiumSubscribers?: number;  // percentage
    // Language distribution
    languageChart?: Record<string, number>;
    // Growth graph (subscriber count over time) — last 30 days
    growthGraph?: GraphPoint[];
    // Followers joined/left per day
    followersGraph?: FollowerPoint[];
    // Views and shares per day
    viewsSharesGraph?: ViewSharePoint[];
    // New member sources: { "Groups": 10, "PM": 5, "Channels": 3 }
    newMemberSources?: Record<string, number>;
    // Views by hour of day (0-23)
    viewsByHour?: number[];
    // Recent post interactions
    recentPosts?: PostInteraction[];
    // Enabled notifications percentage
    enabledNotifications?: number;
    lastUpdated: Timestamp;
}

export interface PricingOption {
    price: number;
    duration: string;
    description?: string;
}

export interface ChannelPricing {
    post?: PricingOption;
    story?: PricingOption;
    forward?: PricingOption;
    [key: string]: PricingOption | undefined;
}

export interface Channel {
    id: string;
    chatId: number;
    ownerId: string;
    admins: string[];
    adminDetails?: ChannelAdminInfo[];  // Detailed admin info with permissions
    username?: string;
    title: string;
    description?: string;
    category?: string;
    photoUrl?: string; // Channel profile photo URL
    stats: ChannelStats;
    pricing: ChannelPricing;
    isActive: boolean;
    botIsAdmin: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// Detailed admin information with Telegram permissions
export interface ChannelAdminInfo {
    userId: string;           // Our system user ID (if exists)
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
    syncedAt: Timestamp;
}

// Ad Request types
export type AdRequestStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type AdFormat = 'post' | 'story' | 'forward';

export interface AdRequest {
    id: string;
    advertiserId: string;
    title: string;
    description: string;
    budget: { min: number; max: number };
    targetAudience?: string;
    preferredFormat: AdFormat;
    requirements?: string;
    minSubscribers?: number;
    maxSubscribers?: number;
    languages?: string[];
    categories?: string[];
    status: AdRequestStatus;
    applicants: string[];
    createdAt: Timestamp;
    expiresAt?: Timestamp | null;
    imageUrl?: string | null;
}

// Deal types
export type DealStatus =
    | 'pending_acceptance'   // Waiting for channel owner to accept
    | 'pending_payment'
    | 'payment_received'
    | 'creative_pending'
    | 'creative_submitted'
    | 'creative_revision'    // Advertiser requested changes
    | 'creative_approved'
    | 'scheduled'
    | 'posted'
    | 'verified'
    | 'completed'
    | 'disputed'
    | 'cancelled'
    | 'refunded';

export type DealSourceType = 'listing' | 'request';

// Advertiser's brief/preferences for the ad
export interface AdBrief {
    suggestedText?: string;
    suggestedImageUrl?: string;
    publishTime?: Timestamp;
    additionalNotes?: string;
    hashtags?: string[];
    callToAction?: string;
}

// Track each creative submission with revision history
export interface CreativeSubmission {
    id: string;
    text: string;
    mediaUrls?: string[];
    buttons?: Array<{ text: string; url: string }>;
    submittedAt: Timestamp;
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;  // Advertiser's feedback if rejected
}

export interface Creative {
    text: string;
    mediaUrls?: string[];
    buttons?: Array<{ text: string; url: string }>;
    submittedAt: Timestamp;
    approvedAt?: Timestamp;
}

export interface VerificationCheck {
    checkedAt: Timestamp;
    postExists: boolean;
    postUnmodified: boolean;
}

export interface Deal {
    id: string;
    channelId: string;
    channelOwnerId: string;
    advertiserId: string;
    sourceType: DealSourceType;
    sourceId: string;
    amount: number;
    format: AdFormat;
    status: DealStatus;
    brief?: AdBrief;                         // Advertiser's requirements
    creative?: Creative;
    creativeHistory?: CreativeSubmission[];  // Track all submissions
    publishWithImage?: boolean;               // Whether to include image in post
    scheduledTime?: Timestamp;
    postedAt?: Timestamp;
    postId?: number;
    postDuration: number;
    verificationChecks: VerificationCheck[];
    escrowWalletAddress: string;
    escrowWalletId?: string;            // Firestore document ID for the escrow wallet
    advertiserWalletAddress?: string;   // Advertiser's wallet for refunds
    escrowBalance: number;
    lastActivityAt: Timestamp;
    autoCancelAfter: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// Message types
export type MessageType = 'text' | 'creative_submission' | 'system';
export type SenderRole = 'advertiser' | 'channel_owner';

export interface Message {
    id: string;
    dealId: string;
    senderId: string;
    senderRole: SenderRole;
    text: string;
    type: MessageType;
    createdAt: Timestamp;
}

// Wallet types
export type WalletType = 'user' | 'deal';

export interface Wallet {
    id: string;
    type: WalletType;
    ownerId: string;
    address: string;
    publicKey: string;
    encryptedSecretKey: string;
    balance: number;
    createdAt: Timestamp;
}

// API Response types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

// Telegram WebApp types
export interface TelegramWebAppUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

export interface TelegramWebAppInitData {
    query_id?: string;
    user?: TelegramWebAppUser;
    auth_date: number;
    hash: string;
}
