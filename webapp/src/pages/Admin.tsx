// Admin Page - Dispute management for admins

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import { api, formatDate, formatTime } from '../lib/api';
import Header from '../components/Header';
import Loading from '../components/Loading';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';

// Admin Telegram IDs - must match backend config
const ADMIN_TELEGRAM_IDS = [523537718];

interface DisputeUser {
    id: string;
    username?: string;
    firstName?: string;
}

interface DisputeChannel {
    id: string;
    title: string;
    username?: string;
}

interface Dispute {
    id: string;
    amount: number;
    status: string;
    createdAt: any;
    updatedAt: any;
    postedAt?: any;
    creative?: {
        text: string;
        mediaUrls?: string[];
    };
    verificationChecks?: Array<{
        checkedAt: any;
        postExists: boolean;
        postUnmodified: boolean;
    }>;
    advertiser: DisputeUser | null;
    channelOwner: DisputeUser | null;
    channel: DisputeChannel | null;
}

function Admin() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();
    const { user } = useAuth();
    const { showConfirm } = useConfirm();
    const { showSuccess, showError } = useToast();

    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
    const [resolving, setResolving] = useState(false);
    const [reason, setReason] = useState('');
    const [recoverAddress, setRecoverAddress] = useState('');
    const [recoverTo, setRecoverTo] = useState('UQB77IA6xgd0N_ZthlLgBir0HykKosa5AmZyh3Q5o6edm3_6');
    const [recovering, setRecovering] = useState(false);

    useEffect(() => {
        checkAdminAndLoad();
    }, [user]);

    const checkAdminAndLoad = async () => {
        // Check admin status locally using telegramId
        if (!user) {
            setIsLoading(false);
            return;
        }

        const userTelegramId = Number(user.telegramId);
        const isUserAdmin = ADMIN_TELEGRAM_IDS.includes(userTelegramId);
        console.log('Admin check - telegramId:', userTelegramId, 'isAdmin:', isUserAdmin);

        setIsAdmin(isUserAdmin);

        if (isUserAdmin) {
            // Load disputes
            await loadDisputes();
        }

        setIsLoading(false);
    };

    const loadDisputes = async () => {
        try {
            const response = await api.get<Dispute[]>('/admin/disputes');
            if (response.success && response.data) {
                setDisputes(response.data as any);
            }
        } catch (error) {
            console.error('Error loading disputes:', error);
        }
    };

    const handleResolve = async (resolution: 'refund' | 'release') => {
        if (!selectedDispute) return;

        const confirmMessage = resolution === 'refund'
            ? `Refund ${selectedDispute.amount} TON to advertiser?`
            : `Release ${selectedDispute.amount} TON to channel owner?`;

        const confirmed = await showConfirm({
            title: resolution === 'refund' ? 'Confirm Refund' : 'Confirm Release',
            message: confirmMessage,
            confirmText: resolution === 'refund' ? 'Refund' : 'Release',
            type: resolution === 'refund' ? 'danger' : 'success',
        });

        if (!confirmed) return;

        setResolving(true);
        hapticFeedback('medium');

        try {
            const response = await api.post(`/admin/disputes/${selectedDispute.id}/resolve`, {
                resolution,
                reason: reason.trim() || undefined,
            });

            if (response.success) {
                hapticFeedback('success');
                showSuccess(`Dispute resolved: ${resolution === 'refund' ? 'Refunded to advertiser' : 'Released to channel owner'}`);
                setSelectedDispute(null);
                setReason('');
                await loadDisputes();
            } else {
                hapticFeedback('error');
                showError((response as any).error || 'Failed to resolve dispute');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to resolve dispute');
        } finally {
            setResolving(false);
        }
    };

    if (isLoading) return <Loading />;

    if (isAdmin === false) {
        return (
            <div>
                <Header title="Admin" />
                <div className="container">
                    <EmptyState
                        icon={<Icon name="lock" size={48} color="var(--text-muted)" />}
                        title="Access Denied"
                        message="You don't have admin permissions."
                        action={{
                            label: 'Go Home',
                            onClick: () => navigate('/'),
                        }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div>
            <Header title="Admin Panel" />

            <div className="container">
                {/* Disputes Section */}
                <div className="section">
                    <h3 className="text-lg font-bold mb-md"><Icon name="scales" size={18} /> Active Disputes</h3>
                    <p className="text-sm text-secondary mb-md">
                        Review and resolve disputes between advertisers and channel owners.
                    </p>
                </div>

                {disputes.length === 0 ? (
                    <EmptyState
                        icon={<Icon name="check" size={48} color="var(--accent-green)" />}
                        title="No Active Disputes"
                        message="All disputes have been resolved. Great job!"
                    />
                ) : (
                    <div className="section">
                        <div className="flex flex-col gap-sm">
                            {disputes.map((dispute) => (
                                <div
                                    key={dispute.id}
                                    className="card"
                                    onClick={() => setSelectedDispute(dispute)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <div className="flex justify-between items-start mb-sm">
                                        <div>
                                            <div className="font-bold">
                                                Deal #{dispute.id.slice(0, 8)}
                                            </div>
                                            <div className="text-sm text-secondary">
                                                {dispute.channel?.title || dispute.channel?.username || 'Unknown Channel'}
                                            </div>
                                        </div>
                                        <div className="badge badge-danger">
                                            {dispute.amount} TON
                                        </div>
                                    </div>

                                    <div className="text-xs text-muted">
                                        <div><Icon name="user" size={12} /> Advertiser: {dispute.advertiser?.username ? '@' + dispute.advertiser.username : dispute.advertiser?.firstName || 'Unknown'}</div>
                                        <div><Icon name="megaphone" size={12} /> Channel Owner: {dispute.channelOwner?.username ? '@' + dispute.channelOwner.username : dispute.channelOwner?.firstName || 'Unknown'}</div>
                                        <div><Icon name="calendar" size={12} /> Created: {formatDate(dispute.createdAt)}</div>
                                    </div>

                                    <div className="text-primary text-sm mt-sm">
                                        Tap to review →
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Fund Recovery Section */}
                <div className="section">
                    <h3 className="text-lg font-bold mb-md"><Icon name="coins" size={18} /> Fund Recovery</h3>
                    <p className="text-sm text-secondary mb-md">
                        Recover stuck funds from escrow wallets.
                    </p>
                    <div className="card">
                        <div className="form-group mb-md">
                            <label className="form-label">Escrow Wallet Address</label>
                            <input
                                className="form-input"
                                placeholder="UQ... or EQ..."
                                value={recoverAddress}
                                onChange={(e) => setRecoverAddress(e.target.value)}
                            />
                        </div>
                        <div className="form-group mb-md">
                            <label className="form-label">Send To</label>
                            <input
                                className="form-input"
                                value={recoverTo}
                                onChange={(e) => setRecoverTo(e.target.value)}
                            />
                        </div>
                        <button
                            className="btn btn-primary btn-block"
                            disabled={recovering || !recoverAddress}
                            onClick={async () => {
                                setRecovering(true);
                                hapticFeedback('medium');
                                try {
                                    const result = await api.post<any>('/admin/recover-funds', {
                                        escrowAddress: recoverAddress,
                                        toAddress: recoverTo,
                                    });
                                    if (result.success && result.data) {
                                        hapticFeedback('success');
                                        showSuccess(`Recovery sent! Balance: ${result.data.balance} TON`);
                                        setRecoverAddress('');
                                    } else {
                                        hapticFeedback('error');
                                        showError((result as any).error || result.data?.error || 'Failed');
                                    }
                                } catch (err: any) {
                                    hapticFeedback('error');
                                    showError(err.message || 'Failed');
                                } finally {
                                    setRecovering(false);
                                }
                            }}
                        >
                            {recovering ? 'Recovering...' : <><Icon name="coins" size={14} /> Recover All Funds</>}
                        </button>
                    </div>
                </div>

                {/* Dispute Detail Modal */}
                {selectedDispute && (
                    <div className="modal-overlay" onClick={() => setSelectedDispute(null)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3>Dispute Detail</h3>
                                <button
                                    className="modal-close"
                                    onClick={() => setSelectedDispute(null)}
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="modal-body">
                                {/* Deal Info */}
                                <div className="card mb-md">
                                    <div className="text-xs text-muted mb-xs">Deal ID</div>
                                    <div className="font-mono text-sm">{selectedDispute.id}</div>
                                </div>

                                {/* Amount */}
                                <div className="card mb-md">
                                    <div className="text-xs text-muted mb-xs">Disputed Amount</div>
                                    <div className="text-xl font-bold text-primary">{selectedDispute.amount} TON</div>
                                </div>

                                {/* Parties */}
                                <div className="card mb-md">
                                    <div className="text-sm mb-sm">
                                        <strong>Advertiser:</strong>{' '}
                                        {selectedDispute.advertiser?.username
                                            ? '@' + selectedDispute.advertiser.username
                                            : selectedDispute.advertiser?.firstName || 'Unknown'}
                                    </div>
                                    <div className="text-sm mb-sm">
                                        <strong>Channel Owner:</strong>{' '}
                                        {selectedDispute.channelOwner?.username
                                            ? '@' + selectedDispute.channelOwner.username
                                            : selectedDispute.channelOwner?.firstName || 'Unknown'}
                                    </div>
                                    <div className="text-sm">
                                        <strong>Channel:</strong>{' '}
                                        {selectedDispute.channel?.title || selectedDispute.channel?.username || 'Unknown'}
                                        {selectedDispute.channel?.username && (
                                            <a
                                                href={`https://t.me/${selectedDispute.channel.username}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary ml-sm"
                                            >
                                                Open →
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Creative */}
                                {selectedDispute.creative && (
                                    <div className="card mb-md">
                                        <div className="text-xs text-muted mb-xs">Creative Content</div>
                                        <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                                            {selectedDispute.creative.text.slice(0, 300)}
                                            {selectedDispute.creative.text.length > 300 && '...'}
                                        </div>
                                    </div>
                                )}

                                {/* Verification History */}
                                {selectedDispute.verificationChecks && selectedDispute.verificationChecks.length > 0 && (
                                    <div className="card mb-md">
                                        <div className="text-xs text-muted mb-sm">Verification History</div>
                                        {selectedDispute.verificationChecks.slice(-3).map((check, idx) => (
                                            <div key={idx} className="text-xs mb-xs">
                                                {formatTime(check.checkedAt)} -
                                                {check.postExists ? <><Icon name="check" size={12} color="var(--accent-green)" /> Exists</> : <><Icon name="close" size={12} color="var(--accent-red)" /> Deleted</>}
                                                {check.postUnmodified ? '' : ' (Modified)'}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Resolution Reason */}
                                <div className="form-group mb-md">
                                    <label className="form-label">Resolution Reason (optional)</label>
                                    <textarea
                                        className="form-input"
                                        placeholder="Enter reason for your decision..."
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        rows={3}
                                    />
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-sm">
                                    <button
                                        className="btn btn-danger flex-1"
                                        onClick={() => handleResolve('refund')}
                                        disabled={resolving}
                                    >
                                        {resolving ? '...' : <><Icon name="coins" size={14} /> Refund Advertiser</>}
                                    </button>
                                    <button
                                        className="btn btn-success flex-1"
                                        onClick={() => handleResolve('release')}
                                        disabled={resolving}
                                    >
                                        {resolving ? '...' : <><Icon name="check" size={14} /> Pay Channel Owner</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Admin;
