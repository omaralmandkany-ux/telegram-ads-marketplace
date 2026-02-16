// Authentication Context - handles user authentication via Telegram

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useTelegram } from './TelegramContext';
import { api } from '../lib/api';

interface User {
    id: string;
    telegramId: number;
    username?: string;
    firstName: string;
    lastName?: string;
    role: 'channel_owner' | 'advertiser' | 'both';
    walletAddress?: string;
    createdAt: string;
    updatedAt: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    error: string | null;
    updateProfile: (data: Partial<User>) => Promise<void>;
    refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const { initData, isReady } = useTelegram();
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUser = async () => {
        if (!initData && !isReady) return;

        setIsLoading(true);
        setError(null);

        try {
            // Get current Telegram user ID from WebApp
            const currentTelegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
            const storedTelegramId = localStorage.getItem('p2p_last_telegram_id');

            // If user changed, clear TonConnect data to prevent wallet sharing
            if (currentTelegramId && storedTelegramId && String(currentTelegramId) !== storedTelegramId) {
                console.log('Telegram user changed, clearing TonConnect data...');
                clearTonConnectData();
            }

            // Store current user ID
            if (currentTelegramId) {
                localStorage.setItem('p2p_last_telegram_id', String(currentTelegramId));
            }

            const response = await api.get('/users/me');
            if (response.success && response.data) {
                setUser(response.data as User);
            } else {
                setError(response.error || 'Failed to fetch user');
            }
        } catch (err: any) {
            console.error('Auth error:', err);
            setError(err.message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    // Clear TonConnect localStorage keys to disconnect wallet
    const clearTonConnectData = () => {
        const tonConnectKeys = [
            'ton-connect-storage_bridge-connection',
            'ton-connect-ui_last-selected-wallet-info',
            'ton-connect-ui_wallet-info',
            'ton-connect-ui_preferred-wallet',
        ];

        // Also clear any dynamic bridge gateway keys
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('ton-connect-storage_http-bridge-gateway')) {
                localStorage.removeItem(key);
            }
        });

        tonConnectKeys.forEach(key => localStorage.removeItem(key));
        console.log('TonConnect data cleared for new user');
    };

    useEffect(() => {
        if (isReady) {
            fetchUser();
        }
    }, [isReady, initData]);

    const updateProfile = async (data: Partial<User>) => {
        try {
            const response = await api.put('/users/me', data);
            if (response.success && response.data) {
                setUser(response.data as User);
            } else {
                throw new Error(response.error || 'Failed to update profile');
            }
        } catch (err: any) {
            throw err;
        }
    };

    const refetchUser = async () => {
        await fetchUser();
    };

    const value: AuthContextType = {
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        updateProfile,
        refetchUser,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
