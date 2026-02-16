// Users API - handles user authentication and profile management

import { Request, Response } from 'express';
import { db, Timestamp } from '../firebase';
import { collections } from '../config';
import { User, ApiResponse } from '../types';
import { validateWebAppData } from '../services/telegram';
import { v4 as uuidv4 } from 'uuid';

// Middleware: Authenticate user from Telegram WebApp init data
export async function authenticateUser(
    req: Request,
    res: Response,
    next: () => void
): Promise<void> {
    const initData = req.headers['x-telegram-init-data'] as string;

    if (!initData) {
        res.status(401).json({ success: false, error: 'No authentication data provided' });
        return;
    }

    const validation = validateWebAppData(initData);

    if (!validation.valid || !validation.userId) {
        res.status(401).json({ success: false, error: 'Invalid authentication data' });
        return;
    }

    // Get or create user
    const userDoc = await db.collection(collections.users)
        .where('telegramId', '==', validation.userId)
        .limit(1)
        .get();

    if (userDoc.empty) {
        // Parse user info from init data
        const params = new URLSearchParams(initData);
        const userParam = params.get('user');
        let userData;

        if (userParam) {
            try {
                userData = JSON.parse(userParam);
            } catch (e) {
                userData = { id: validation.userId, first_name: 'User' };
            }
        } else {
            userData = { id: validation.userId, first_name: 'User' };
        }

        // Create new user
        const newUser: User = {
            id: uuidv4(),
            telegramId: validation.userId,
            username: userData.username,
            firstName: userData.first_name,
            lastName: userData.last_name,
            role: 'both', // Default to both roles
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        await db.collection(collections.users).doc(newUser.id).set(newUser);
        (req as any).user = newUser;
    } else {
        (req as any).user = userDoc.docs[0].data() as User;
    }

    next();
}

// Get current user profile
export async function getProfile(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;

    const response: ApiResponse<User> = {
        success: true,
        data: user,
    };

    res.json(response);
}

// Update user profile
export async function updateProfile(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;
    const { role, walletAddress } = req.body;

    const updates: Partial<User> = {
        updatedAt: Timestamp.now(),
    };

    if (role && ['channel_owner', 'advertiser', 'both'].includes(role)) {
        updates.role = role;
    }

    if (walletAddress !== undefined) {
        // Validate TON address
        const { isValidTonAddress } = await import('../services/ton');
        if (walletAddress && !isValidTonAddress(walletAddress)) {
            res.status(400).json({ success: false, error: 'Invalid TON wallet address' });
            return;
        }
        updates.walletAddress = walletAddress;
    }

    await db.collection(collections.users).doc(user.id).update(updates);

    const updatedDoc = await db.collection(collections.users).doc(user.id).get();

    res.json({
        success: true,
        data: updatedDoc.data(),
    });
}

// Get user by ID (for viewing other users' public info)
export async function getUserById(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;

    const userDoc = await db.collection(collections.users).doc(userId).get();

    if (!userDoc.exists) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
    }

    const user = userDoc.data() as User;

    // Return only public info
    const publicInfo = {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        role: user.role,
    };

    res.json({
        success: true,
        data: publicInfo,
    });
}

// Get user's wallet info
export async function getWalletInfo(req: Request, res: Response): Promise<void> {
    const user = (req as any).user as User;

    const { getWalletBalance } = await import('../services/ton');

    let balance = 0;
    if (user.walletAddress) {
        balance = await getWalletBalance(user.walletAddress);
    }

    res.json({
        success: true,
        data: {
            address: user.walletAddress,
            balance,
        },
    });
}
