// Profile Page - User profile with TON wallet management

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonConnectUI, useTonWallet, toUserFriendlyAddress } from '@tonconnect/ui-react';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import { api, Deal } from '../lib/api';
import Icon from '../components/Icon';

// Use mainnet API for balance
const USE_TESTNET = false;
const TON_API_BASE = USE_TESTNET
    ? 'https://testnet.toncenter.com/api/v2'
    : 'https://toncenter.com/api/v2';

function Wallet() {
    const [tonConnectUI] = useTonConnectUI();
    const wallet = useTonWallet();
    const { hapticFeedback, showAlert } = useTelegram();
    const { user, updateProfile } = useAuth();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(false);
    const [balance, setBalance] = useState<number | null>(null);
    const [isLoadingBalance, setIsLoadingBalance] = useState(false);
    const [totalVolume, setTotalVolume] = useState<number>(0);
    const [totalDeals, setTotalDeals] = useState<number>(0);
    const [completedDeals, setCompletedDeals] = useState<number>(0);

    useEffect(() => {
        // When TON Connect wallet changes, update user profile
        if (wallet) {
            const address = wallet.account.address;
            if (address !== user?.walletAddress) {
                saveWalletAddress(address);
            }
            // Load balance from TON API
            loadBalance(address);
        }
    }, [wallet]);

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        try {
            const response = await api.get<{ data: Deal[] }>('/deals');
            if (response.success && response.data) {
                const rawData = response.data as any;
                const deals: Deal[] = rawData.data || rawData || [];
                setTotalDeals(deals.length);
                const completed = deals.filter((d: Deal) => d.status === 'completed');
                setCompletedDeals(completed.length);
                const volume = completed.reduce((sum: number, d: Deal) => sum + (d.amount || 0), 0);
                setTotalVolume(volume);
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    };

    const loadBalance = async (rawAddress: string) => {
        setIsLoadingBalance(true);
        try {
            const response = await fetch(
                `${TON_API_BASE}/getAddressBalance?address=${rawAddress}`
            );
            const data = await response.json();
            if (data.ok && data.result) {
                // Convert from nanoTON to TON
                const tonBalance = parseFloat(data.result) / 1_000_000_000;
                setBalance(tonBalance);
            }
        } catch (error) {
            console.error('Error loading balance:', error);
        } finally {
            setIsLoadingBalance(false);
        }
    };

    const saveWalletAddress = async (address: string) => {
        setIsLoading(true);
        try {
            await updateProfile({ walletAddress: address } as any);
            hapticFeedback('success');
            await showAlert('Wallet connected successfully!');
        } catch (error: any) {
            hapticFeedback('error');
            await showAlert(error.message || 'Failed to save wallet');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnect = async () => {
        hapticFeedback('light');
        try {
            await tonConnectUI.openModal();
        } catch (error) {
            console.error('Error opening TON Connect:', error);
        }
    };

    const handleDisconnect = async () => {
        hapticFeedback('light');
        try {
            await tonConnectUI.disconnect();
            await updateProfile({ walletAddress: undefined } as any);
            setBalance(null);
            hapticFeedback('success');
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    };

    const handleRefreshBalance = () => {
        if (wallet) {
            loadBalance(wallet.account.address);
            hapticFeedback('light');
        }
    };

    const handleContactSupport = () => {
        hapticFeedback('light');
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
            tg.openTelegramLink('https://t.me/PHo_iraq');
        } else {
            window.open('https://t.me/PHo_iraq', '_blank');
        }
    };

    return (
        <div>

            <div className="container animate-fadeIn">
                {/* Profile Header */}
                <div className="section">
                    <div className="card" style={{
                        background: 'linear-gradient(135deg, #161b22 0%, #1c2333 100%)',
                        border: '1px solid #30363d',
                        textAlign: 'center',
                        padding: '28px 20px',
                    }}>
                        <div style={{
                            width: 72,
                            height: 72,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #00aaff, #0088cc)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 28,
                            fontWeight: 700,
                            color: 'white',
                            margin: '0 auto 12px',
                            border: '3px solid rgba(0, 170, 255, 0.3)',
                        }}>
                            {user?.firstName?.charAt(0) || '?'}
                        </div>
                        <h2 className="text-xl" style={{ marginBottom: 4 }}>
                            {user?.firstName} {user?.lastName || ''}
                        </h2>
                        {(user as any)?.username && (
                            <p className="text-sm text-muted" style={{ marginBottom: 0 }}>
                                @{(user as any).username}
                            </p>
                        )}
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="section">
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '10px',
                    }}>
                        <div className="card" style={{
                            textAlign: 'center',
                            padding: '16px 10px',
                            background: '#161b22',
                            border: '1px solid #30363d',
                        }}>
                            <div style={{
                                fontSize: 22,
                                fontWeight: 700,
                                color: '#00aaff',
                                marginBottom: 4,
                            }}>{totalVolume.toFixed(1)}</div>
                            <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, textTransform: 'uppercase' }}>
                                Total Volume (TON)
                            </div>
                        </div>
                        <div className="card" style={{
                            textAlign: 'center',
                            padding: '16px 10px',
                            background: '#161b22',
                            border: '1px solid #30363d',
                        }}>
                            <div style={{
                                fontSize: 22,
                                fontWeight: 700,
                                color: '#10b981',
                                marginBottom: 4,
                            }}>{completedDeals}</div>
                            <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, textTransform: 'uppercase' }}>
                                Completed
                            </div>
                        </div>
                        <div className="card" style={{
                            textAlign: 'center',
                            padding: '16px 10px',
                            background: '#161b22',
                            border: '1px solid #30363d',
                        }}>
                            <div style={{
                                fontSize: 22,
                                fontWeight: 700,
                                color: '#f59e0b',
                                marginBottom: 4,
                            }}>{totalDeals}</div>
                            <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, textTransform: 'uppercase' }}>
                                Total Deals
                            </div>
                        </div>
                    </div>
                </div>

                {/* TON Wallet Section */}
                <div className="section">
                    <h3 className="section-title mb-md"><Icon name="ton" size={18} /> TON Wallet</h3>
                    <div className="card" style={{
                        background: 'linear-gradient(135deg, #0088cc 0%, #0099ff 100%)',
                        border: 'none'
                    }}>
                        {wallet ? (
                            <div>
                                <div className="mb-md">
                                    <div className="text-xs" style={{ opacity: 0.7 }}>Address</div>
                                    <div className="font-semibold" style={{ wordBreak: 'break-all', fontSize: '13px' }}>
                                        {toUserFriendlyAddress(wallet.account.address, USE_TESTNET)}
                                    </div>
                                </div>

                                <div className="mb-lg">
                                    <div className="text-xs" style={{ opacity: 0.7 }}>Balance</div>
                                    <div className="flex items-center gap-sm">
                                        <div className="text-2xl font-bold">
                                            {isLoadingBalance ? '...' : (balance !== null ? balance.toFixed(2) : '0.00')} TON
                                        </div>
                                        <button
                                            onClick={handleRefreshBalance}
                                            style={{
                                                background: 'rgba(255,255,255,0.2)',
                                                border: 'none',
                                                borderRadius: '50%',
                                                width: '28px',
                                                height: '28px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <Icon name="refresh" size={14} />
                                        </button>
                                    </div>
                                </div>

                                <button
                                    className="btn btn-secondary btn-block"
                                    onClick={handleDisconnect}
                                >
                                    Disconnect Wallet
                                </button>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '12px 0' }}>
                                <div style={{ marginBottom: 12 }}>
                                    <Icon name="ton" size={36} color="#ffffff" />
                                </div>
                                <p style={{ opacity: 0.85, marginBottom: 16, fontSize: 14 }}>
                                    Connect your wallet to send and receive payments
                                </p>
                                <button
                                    className="btn btn-block"
                                    style={{ background: 'white', color: '#0088cc' }}
                                    onClick={handleConnect}
                                    disabled={isLoading}
                                >
                                    {isLoading ? 'Connecting...' : <><Icon name="linkConnect" size={16} /> Connect Wallet</>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Menu Items */}
                <div className="section">
                    <h3 className="section-title mb-md">Settings</h3>
                    <div className="flex flex-col" style={{ gap: 2 }}>
                        {/* My Channels */}
                        <button
                            onClick={() => { hapticFeedback('light'); navigate('/my-channels'); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 16px',
                                background: '#161b22',
                                border: '1px solid #30363d',
                                borderRadius: '12px 12px 4px 4px',
                                color: '#c9d1d9',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }}
                        >
                            <Icon name="megaphone" size={20} color="#00aaff" />
                            <span style={{ flex: 1 }}>My Channels</span>
                            <Icon name="chevronRight" size={16} color="#6e7681" />
                        </button>

                        {/* My Deals */}
                        <button
                            onClick={() => { hapticFeedback('light'); navigate('/deals'); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 16px',
                                background: '#161b22',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                color: '#c9d1d9',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }}
                        >
                            <Icon name="deals" size={20} color="#10b981" />
                            <span style={{ flex: 1 }}>My Deals</span>
                            <Icon name="chevronRight" size={16} color="#6e7681" />
                        </button>

                        {/* Contact Support */}
                        <button
                            onClick={handleContactSupport}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 16px',
                                background: '#161b22',
                                border: '1px solid #30363d',
                                borderRadius: '4px 4px 12px 12px',
                                color: '#c9d1d9',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }}
                        >
                            <Icon name="send" size={20} color="#f59e0b" />
                            <span style={{ flex: 1 }}>Contact Support</span>
                            <Icon name="chevronRight" size={16} color="#6e7681" />
                        </button>
                    </div>
                </div>

                {/* Platform Info */}
                <div className="section">
                    <div className="card" style={{
                        borderColor: 'var(--accent-blue)',
                        background: '#161b22',
                    }}>
                        <h4 className="mb-sm"><Icon name="shield" size={16} /> Escrow Protection</h4>
                        <p className="text-secondary text-sm" style={{ marginBottom: 8 }}>
                            All payments are secured through smart contract escrow.
                            Funds are only released when deals are completed.
                        </p>
                        <p className="text-muted text-xs" style={{ margin: 0 }}>
                            Platform fee: 5% per completed deal
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Wallet;
