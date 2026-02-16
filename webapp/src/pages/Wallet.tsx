// Wallet Page - TON wallet management

import { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet, toUserFriendlyAddress } from '@tonconnect/ui-react';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
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

    const [isLoading, setIsLoading] = useState(false);
    const [balance, setBalance] = useState<number | null>(null);
    const [isLoadingBalance, setIsLoadingBalance] = useState(false);

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

    return (
        <div>
            <Header title="Wallet" />

            <div className="container animate-fadeIn">
                {/* TON Wallet Section */}
                <div className="section">
                    <div className="card" style={{
                        background: 'linear-gradient(135deg, #0088cc 0%, #0099ff 100%)',
                        border: 'none'
                    }}>
                        <div className="flex items-center gap-md mb-lg">
                            <div style={{ fontSize: '40px' }}>💎</div>
                            <div>
                                <h2 className="text-xl">TON Wallet</h2>
                                <p className="text-primary" style={{ opacity: 0.8 }}>
                                    {wallet ? 'Connected' : 'Not connected'}
                                    {USE_TESTNET && wallet && ' (Testnet)'}
                                </p>
                            </div>
                        </div>

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
                            <button
                                className="btn btn-block"
                                style={{ background: 'white', color: '#0088cc' }}
                                onClick={handleConnect}
                                disabled={isLoading}
                            >
                                {isLoading ? 'Connecting...' : <><Icon name="linkConnect" size={16} /> Connect Wallet</>}
                            </button>
                        )}
                    </div>
                </div>

                {/* Info Section */}
                <div className="section">
                    <h3 className="section-title mb-md"><Icon name="info" size={18} /> How it works</h3>

                    <div className="flex flex-col gap-sm">
                        <div className="card">
                            <h4 className="mb-sm"><Icon name="dollar" size={16} /> For Advertisers</h4>
                            <p className="text-secondary text-sm">
                                When you create a deal, you'll send TON to a secure escrow wallet.
                                Funds are released to the channel owner only after the ad is successfully posted and verified.
                            </p>
                        </div>

                        <div className="card">
                            <h4 className="mb-sm"><Icon name="megaphone" size={16} /> For Channel Owners</h4>
                            <p className="text-secondary text-sm">
                                Connect your wallet to receive payments. After your post is verified,
                                funds are automatically released to your connected wallet (minus a small platform fee).
                            </p>
                        </div>

                        <div className="card">
                            <h4 className="mb-sm"><Icon name="lock" size={16} /> Escrow Protection</h4>
                            <p className="text-secondary text-sm">
                                All funds are held in secure escrow until the deal is completed.
                                If there's a dispute, an admin will review and resolve it fairly.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Platform Fee Info */}
                <div className="section">
                    <div className="card" style={{ borderColor: 'var(--accent-blue)' }}>
                        <h4 className="mb-sm"><Icon name="chartBar" size={16} /> Platform Fee</h4>
                        <p className="text-secondary text-sm">
                            A 5% platform fee is deducted from each completed deal.
                            This helps us maintain the platform and provide support.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Wallet;
