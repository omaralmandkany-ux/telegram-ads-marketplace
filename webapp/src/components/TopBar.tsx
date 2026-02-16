// TopBar Component - Fixed header with balance, user info, and settings

import { useState, useEffect } from 'react';
import { useTonWallet } from '@tonconnect/ui-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Icon from './Icon';
import './TopBar.css';

function TopBar() {
    const { user } = useAuth();
    const { theme, language, toggleTheme, setLanguage, t } = useTheme();
    const [showSettings, setShowSettings] = useState(false);
    const [imageError, setImageError] = useState(false);
    const wallet = useTonWallet();
    const [balance, setBalance] = useState(0);

    // Fetch real balance from TON blockchain
    useEffect(() => {
        if (!wallet?.account?.address) {
            setBalance(0);
            return;
        }
        const fetchBalance = async () => {
            try {
                const res = await fetch(`https://toncenter.com/api/v2/getAddressBalance?address=${wallet.account.address}`);
                const data = await res.json();
                if (data.ok && data.result) {
                    setBalance(parseFloat(data.result) / 1_000_000_000);
                }
            } catch (e) {
                console.error('Balance fetch error:', e);
            }
        };
        fetchBalance();
        const interval = setInterval(fetchBalance, 60000); // Refresh every 60s
        return () => clearInterval(interval);
    }, [wallet?.account?.address]);

    // Get Telegram user photo from WebApp
    const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user as any;
    const userPhoto = telegramUser?.photo_url;
    const userInitial = user?.firstName?.charAt(0) || telegramUser?.first_name?.charAt(0) || 'U';

    return (
        <>
            <header className="top-bar">
                <div className="top-bar-content">
                    {/* User Info */}
                    <div className="top-bar-user">
                        <div className="top-bar-avatar">
                            {userPhoto && !imageError ? (
                                <img
                                    src={userPhoto}
                                    alt="Profile"
                                    className="top-bar-avatar-img"
                                    onError={() => setImageError(true)}
                                />
                            ) : (
                                userInitial
                            )}
                        </div>
                        <div className="top-bar-greeting">
                            <span className="top-bar-name">{user?.firstName || telegramUser?.first_name || 'User'}</span>
                        </div>
                    </div>

                    {/* Balance */}
                    <div className="top-bar-balance">
                        <Icon name="ton" size={18} />
                        <span className="balance-amount">{balance.toFixed(2)}</span>
                        <span className="balance-currency">TON</span>
                    </div>

                    {/* Settings Button */}
                    <button
                        className="top-bar-settings"
                        onClick={() => setShowSettings(true)}
                    >
                        <Icon name="settings" size={22} />
                    </button>
                </div>
            </header>

            {/* Settings Modal */}
            {showSettings && (
                <div className="settings-overlay" onClick={() => setShowSettings(false)}>
                    <div className="settings-modal" onClick={e => e.stopPropagation()}>
                        <div className="settings-header">
                            <h3>{t('settings')}</h3>
                            <button
                                className="settings-close"
                                onClick={() => setShowSettings(false)}
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>

                        <div className="settings-body">
                            {/* Theme Toggle */}
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={20} />
                                    <span>{t('dark_mode')}</span>
                                </div>
                                <button
                                    className={`toggle-switch ${theme === 'dark' ? 'active' : ''}`}
                                    onClick={toggleTheme}
                                >
                                    <div className="toggle-thumb" />
                                </button>
                            </div>

                            {/* Language Selection */}
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <Icon name="globe" size={20} />
                                    <span>{t('language')}</span>
                                </div>
                                <div className="language-buttons">
                                    <button
                                        className={`lang-btn ${language === 'en' ? 'active' : ''}`}
                                        onClick={() => setLanguage('en')}
                                    >
                                        EN
                                    </button>
                                    <button
                                        className={`lang-btn ${language === 'ar' ? 'active' : ''}`}
                                        onClick={() => setLanguage('ar')}
                                    >
                                        عربي
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="settings-footer">
                            <span className="settings-version">P2P Ads v2.3.0</span>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default TopBar;
