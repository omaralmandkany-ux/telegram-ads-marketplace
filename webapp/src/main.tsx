import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TonConnectUIProvider, THEME } from '@tonconnect/ui-react'
import App from './App'
import { TelegramProvider } from './contexts/TelegramContext'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmModal'
import './styles/index.css'

// TON Connect manifest URL
const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`

// Set to true for testnet, false for mainnet
const USE_TESTNET = false

// ========== IMPORTANT: Clear TonConnect data if Telegram user changed ==========
// This MUST run BEFORE TonConnectUIProvider initializes to prevent restoring old wallet
const clearTonConnectIfUserChanged = () => {
    try {
        const currentTelegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        const storedTelegramId = localStorage.getItem('p2p_last_telegram_id');

        if (currentTelegramId && storedTelegramId && String(currentTelegramId) !== storedTelegramId) {
            console.log('⚠️ Telegram user changed! Clearing TonConnect data...');

            // Clear all TonConnect localStorage keys
            const tonConnectKeys = [
                'ton-connect-storage_bridge-connection',
                'ton-connect-ui_last-selected-wallet-info',
                'ton-connect-ui_wallet-info',
                'ton-connect-ui_preferred-wallet',
            ];

            // Clear specific keys
            tonConnectKeys.forEach(key => localStorage.removeItem(key));

            // Clear dynamic bridge gateway keys
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('ton-connect-storage_http-bridge-gateway')) {
                    localStorage.removeItem(key);
                }
            });

            console.log('✅ TonConnect data cleared for new user');
        }

        // Always update stored telegram ID
        if (currentTelegramId) {
            localStorage.setItem('p2p_last_telegram_id', String(currentTelegramId));
        }
    } catch (error) {
        console.error('Error checking user change:', error);
    }
};

// Run cleanup BEFORE React renders
clearTonConnectIfUserChanged();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <TonConnectUIProvider
                manifestUrl={manifestUrl}
                uiPreferences={{ theme: THEME.DARK }}
                walletsListConfiguration={{
                    includeWallets: [
                        {
                            appName: 'tonkeeper',
                            name: 'Tonkeeper',
                            imageUrl: 'https://tonkeeper.com/assets/tonconnect-icon.png',
                            aboutUrl: 'https://tonkeeper.com',
                            universalLink: USE_TESTNET
                                ? 'https://app.tonkeeper.com/ton-connect'
                                : 'https://app.tonkeeper.com/ton-connect',
                            bridgeUrl: 'https://bridge.tonapi.io/bridge',
                            platforms: ['ios', 'android', 'chrome', 'firefox', 'safari']
                        },
                        {
                            appName: 'mytonwallet',
                            name: 'MyTonWallet',
                            imageUrl: 'https://mytonwallet.io/icon-256.png',
                            aboutUrl: 'https://mytonwallet.io',
                            universalLink: 'https://mytonwallet.io/ton-connect',
                            bridgeUrl: 'https://mytonwallet.io/tonconnect-bridge',
                            platforms: ['ios', 'android', 'chrome', 'firefox', 'safari', 'linux', 'macos', 'windows']
                        }
                    ]
                }}
                actionsConfiguration={{
                    twaReturnUrl: 'https://t.me/p2p_adsBot/app'
                }}
                restoreConnection={true}
            >
                <TelegramProvider>
                    <AuthProvider>
                        <ThemeProvider>
                            <ToastProvider>
                                <ConfirmProvider>
                                    <App />
                                </ConfirmProvider>
                            </ToastProvider>
                        </ThemeProvider>
                    </AuthProvider>
                </TelegramProvider>
            </TonConnectUIProvider>
        </BrowserRouter>
    </React.StrictMode>,
)

