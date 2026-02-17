// Deal Detail Page - Full deal management with creative workflow

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import { api, Deal, getStatusLabel, getStatusColor, formatDate, formatTime } from '../lib/api';
import Header from '../components/Header';
import Loading from '../components/Loading';
import Icon from '../components/Icon';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';

function DealDetail() {
    const { dealId } = useParams<{ dealId: string }>();
    const { hapticFeedback } = useTelegram();
    const { user } = useAuth();
    const { showConfirm } = useConfirm();
    const { showError, showSuccess } = useToast();
    const [tonConnectUI] = useTonConnectUI();
    const userWalletAddress = useTonAddress();

    const [deal, setDeal] = useState<Deal | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreativeModal, setShowCreativeModal] = useState(false);
    const [creativeText, setCreativeText] = useState('');
    const [creativeImageUrl, setCreativeImageUrl] = useState('');
    const [creativeScheduledTime, setCreativeScheduledTime] = useState('');
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [scheduledTime, setScheduledTime] = useState('');
    const [isPaying, setIsPaying] = useState(false);
    const [botUsername, setBotUsername] = useState<string>('');

    const isAdvertiser = deal?.advertiserId === user?.id;
    const isChannelOwner = deal?.channelOwnerId === user?.id;

    // Debug: Log role identification
    console.log('Deal Debug:', {
        userId: user?.id,
        advertiserId: deal?.advertiserId,
        channelOwnerId: deal?.channelOwnerId,
        isAdvertiser,
        isChannelOwner,
        status: deal?.status
    });

    useEffect(() => {
        loadDeal();
        // Fetch bot username for relay messaging deep links
        fetch('https://us-central1-telegramp2p-9a891.cloudfunctions.net/api/bot-info')
            .then(r => r.json())
            .then(d => { if (d.success && d.data?.username) setBotUsername(d.data.username); })
            .catch(() => { });
    }, [dealId]);

    const loadDeal = async () => {
        if (!dealId) return;

        setIsLoading(true);
        try {
            const dealRes = await api.get<Deal>(`/deals/${dealId}`);

            if (dealRes.success && dealRes.data) {
                setDeal(dealRes.data);
                if (dealRes.data.creative?.text) {
                    setCreativeText(dealRes.data.creative.text);
                }
            }
        } catch (error) {
            console.error('Error loading deal:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const updateStatus = async (newStatus: string, data?: any) => {
        if (!deal) return;

        hapticFeedback('medium');

        try {
            const response = await api.put(`/deals/${deal.id}/status`, {
                status: newStatus,
                ...data,
            });

            if (response.success) {
                hapticFeedback('success');
                loadDeal();
            } else {
                hapticFeedback('error');
                showError(response.error || 'Failed to update deal');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to update deal');
        }
    };

    const handleSubmitCreative = async () => {
        if (!creativeText.trim()) {
            showError('Please enter the creative content');
            return;
        }

        if (!creativeScheduledTime) {
            showError('Please select a publish time');
            return;
        }

        await updateStatus('creative_submitted', {
            creative: {
                text: creativeText.trim(),
                mediaUrl: creativeImageUrl || undefined,
            },
            scheduledTime: creativeScheduledTime,
        });

        setShowCreativeModal(false);
    };

    const handleApproveCreative = async () => {
        const confirmed = await showConfirm({ message: 'Approve this creative? It will be posted at the scheduled time.', confirmText: 'Approve', type: 'success' });
        if (confirmed) {
            // Approve and auto-schedule for posting
            await updateStatus('scheduled');
        }
    };

    // Image upload handler for creative
    const handleCreativeImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showError('Image must be less than 5MB');
            return;
        }

        setIsUploadingImage(true);
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result as string;

                const response = await api.post<any>('/upload', {
                    data: base64Data,
                    mimeType: file.type,
                    filename: file.name,
                });

                if (response.success && response.data?.url) {
                    setCreativeImageUrl(response.data.url);
                    hapticFeedback('success');
                } else {
                    showError(response.error || 'Failed to upload image');
                }
                setIsUploadingImage(false);
            };
            reader.onerror = () => {
                showError('Failed to read image');
                setIsUploadingImage(false);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            showError('Image upload failed');
            setIsUploadingImage(false);
        }
    };

    // Open creative modal with pre-filled values from brief
    const openCreativeModal = () => {
        if (deal?.brief) {
            setCreativeText(deal.brief.suggestedText || '');
            setCreativeImageUrl(deal.brief.suggestedImageUrl || '');
            // Pre-fill scheduled time from brief if available
            if (deal.brief.publishTime) {
                const pt = deal.brief.publishTime as any;
                const date = new Date(pt._seconds ? pt._seconds * 1000 : pt);
                setCreativeScheduledTime(date.toISOString().slice(0, 16));
            } else {
                setCreativeScheduledTime('');
            }
        }
        setShowCreativeModal(true);
    };

    // New workflow handlers
    const [revisionFeedback, setRevisionFeedback] = useState('');
    const [showRevisionModal, setShowRevisionModal] = useState(false);

    const handleAcceptDeal = async () => {
        const confirmed = await showConfirm({
            title: 'Accept Deal',
            message: 'Accept this deal request? You will need to create the ad content after payment.',
            confirmText: 'Accept',
            type: 'success'
        });
        if (!confirmed) return;

        try {
            const response = await api.post(`/deals/${deal!.id}/accept`, {});
            if (response.success) {
                hapticFeedback('success');
                showSuccess('Deal accepted!');
                loadDeal();
            } else {
                showError(response.error || 'Failed to accept deal');
            }
        } catch (error: any) {
            showError(error.message || 'Failed to accept deal');
        }
    };

    const handleRejectDeal = async () => {
        const confirmed = await showConfirm({
            title: 'Reject Deal',
            message: 'Reject this deal request?',
            confirmText: 'Reject',
            type: 'danger'
        });
        if (!confirmed) return;

        try {
            const response = await api.post(`/deals/${deal!.id}/reject`, {});
            if (response.success) {
                hapticFeedback('success');
                showSuccess('Deal rejected');
                loadDeal();
            } else {
                showError(response.error || 'Failed to reject deal');
            }
        } catch (error: any) {
            showError(error.message || 'Failed to reject deal');
        }
    };

    const handleRequestRevision = async () => {
        if (!revisionFeedback.trim()) {
            showError('Please provide feedback for the channel owner');
            return;
        }

        try {
            const response = await api.post(`/deals/${deal!.id}/request-revision`, {
                feedback: revisionFeedback.trim()
            });
            if (response.success) {
                hapticFeedback('success');
                showSuccess('Revision requested');
                setShowRevisionModal(false);
                setRevisionFeedback('');
                loadDeal();
            } else {
                showError(response.error || 'Failed to request revision');
            }
        } catch (error: any) {
            showError(error.message || 'Failed to request revision');
        }
    };

    const handleSchedule = async () => {
        if (!scheduledTime) {
            showError('Please select a date and time');
            return;
        }

        await updateStatus('scheduled', { scheduledTime });
    };

    const handlePostNow = async () => {
        const confirmed = await showConfirm({ message: 'Post this ad immediately?', confirmText: 'Post Now', type: 'success' });
        if (confirmed) {
            // Schedule for immediate posting (1 minute from now)
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            await updateStatus('scheduled', { scheduledTime: now.toISOString() });
        }
    };

    const handleCancel = async () => {
        const confirmed = await showConfirm({ title: 'Cancel Deal', message: 'Cancel this deal? This action cannot be undone.', confirmText: 'Cancel Deal', type: 'danger' });
        if (confirmed) {
            await updateStatus('cancelled');
        }
    };

    const handleDispute = async () => {
        const confirmed = await showConfirm({ title: 'Raise Dispute', message: 'Raise a dispute for this deal?', confirmText: 'Raise Dispute', type: 'danger' });
        if (confirmed) {
            await updateStatus('disputed');
        }
    };

    // Send payment via TonConnect + auto-poll for confirmation
    const handlePayNow = async () => {
        if (!deal?.escrowWalletAddress) {
            showError('Escrow wallet address not available');
            return;
        }

        if (!userWalletAddress) {
            // Open wallet connection modal
            tonConnectUI.openModal();
            return;
        }

        setIsPaying(true);
        hapticFeedback('medium');

        try {
            // Convert TON to nanoTON (1 TON = 10^9 nanoTON)
            const amountInNanoTon = Math.floor(deal.amount * 1_000_000_000).toString();

            const transaction = {
                validUntil: Math.floor(Date.now() / 1000) + 600, // 10 minutes
                messages: [
                    {
                        address: deal.escrowWalletAddress,
                        amount: amountInNanoTon,
                    },
                ],
            };

            await tonConnectUI.sendTransaction(transaction);

            hapticFeedback('success');
            showSuccess('Payment sent! Confirming automatically...');

            // Auto-poll for payment confirmation every 1.5s
            let attempts = 0;
            const maxAttempts = 40; // ~60 seconds
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const result = await api.post<any>(`/deals/${deal.id}/check-payment`, {
                        advertiserWalletAddress: userWalletAddress,
                    });
                    if (result.success && result.data?.paymentReceived) {
                        clearInterval(pollInterval);
                        hapticFeedback('success');
                        showSuccess('✅ Payment confirmed!');
                        setIsPaying(false);
                        loadDeal();
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        setIsPaying(false);
                        showError('Payment not confirmed yet. Please wait and refresh.');
                        loadDeal();
                    }
                } catch {
                    if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        setIsPaying(false);
                    }
                }
            }, 1500);
        } catch (error: any) {
            hapticFeedback('error');
            setIsPaying(false);
            if (error.message?.includes('Cancelled')) {
                showError('Payment cancelled');
            } else {
                showError(error.message || 'Payment failed');
            }
        }
    };

    if (isLoading) return <Loading />;

    if (!deal) {
        return (
            <div>
                <Header title="Deal" showBack />
                <div className="container">
                    <div className="empty-state">
                        <div className="empty-state-icon"><Icon name="close" size={48} color="var(--accent-red)" /></div>
                        <h3 className="empty-state-title">Deal not found</h3>
                    </div>
                </div>
            </div>
        );
    }

    const statusLabel = getStatusLabel(deal.status);
    const statusColor = getStatusColor(deal.status);

    return (
        <div>
            <Header title={`Deal #${deal.id.slice(0, 8)}`} showBack backTo="/deals" />

            <div className="container animate-fadeIn">
                {/* Deal Status Card */}
                <div className="section">
                    <div className="card">
                        <div className="flex justify-between items-start mb-md">
                            <div>
                                <span className={`badge badge-${statusColor}`}>{statusLabel}</span>
                                <div className="text-sm text-secondary mt-sm">
                                    {isAdvertiser ? 'You are the Advertiser' : 'You are the Channel Owner'}
                                </div>
                            </div>
                            <span className="price-tag price-tag-ton"><Icon name="ton" size={16} /> {deal.amount} TON</span>
                        </div>

                        {deal.channel && (
                            <div className="flex items-center gap-sm mb-md">
                                <Icon name="megaphone" size={16} />
                                <span>@{deal.channel.username || deal.channel.title}</span>
                            </div>
                        )}

                        <div className="text-sm text-secondary">
                            Created {formatDate(deal.createdAt)} at {formatTime(deal.createdAt)}
                        </div>
                    </div>
                </div>

                {/* Payment Info (for pending payment) */}
                {deal.status === 'pending_payment' && isAdvertiser && (
                    <div className="section">
                        <div className="card" style={{ borderColor: 'var(--accent-yellow)' }}>
                            <h4 className="mb-md"><Icon name="coins" size={18} /> Payment Required</h4>

                            {/* Show Brief / Ad Details inline */}
                            {deal.brief && (
                                <div className="mb-md p-md" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                    <h4 className="mb-sm" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        <Icon name="message" size={14} /> Ad Details
                                    </h4>
                                    {deal.brief.suggestedText && (
                                        <p className="text-sm mb-sm" style={{ whiteSpace: 'pre-wrap' }}>{deal.brief.suggestedText}</p>
                                    )}
                                    {deal.brief.suggestedImageUrl && (
                                        <img src={deal.brief.suggestedImageUrl} alt="Ad" style={{ width: '100%', maxHeight: '150px', objectFit: 'cover', borderRadius: 'var(--radius-md)', marginBottom: '8px' }} />
                                    )}
                                    {deal.brief.additionalNotes && (
                                        <p className="text-xs text-muted"><strong>Notes:</strong> {deal.brief.additionalNotes}</p>
                                    )}
                                </div>
                            )}

                            <p className="text-secondary mb-md">
                                Send <strong>{deal.amount} TON</strong> to complete this deal.
                            </p>

                            {/* Pay Now Button */}
                            <button
                                className="btn btn-primary btn-block mb-md"
                                onClick={handlePayNow}
                                disabled={isPaying}
                            >
                                {isPaying ? (
                                    <><Icon name="loader" size={16} /> Confirming payment...</>
                                ) : userWalletAddress ? (
                                    <><Icon name="creditCard" size={16} /> Pay {deal.amount} TON Now</>
                                ) : (
                                    <><Icon name="linkConnect" size={16} /> Connect Wallet to Pay</>
                                )}
                            </button>
                            <p className="text-xs text-muted text-center mt-md">
                                Payment will be confirmed automatically.
                            </p>
                        </div>
                    </div>
                )}

                {/* Pending Acceptance - Channel Owner Accept/Reject */}
                {deal.status === 'pending_acceptance' && (
                    <div className="section">
                        <div className="card" style={{ borderColor: 'var(--accent-blue)' }}>
                            <h4 className="mb-md"><Icon name="message" size={18} /> New Deal Request</h4>

                            {/* Show Brief if available */}
                            {deal.brief && (
                                <div className="mb-md p-md" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                    <h4 className="mb-sm" style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                                        <Icon name="message" size={14} /> Advertiser's Brief
                                    </h4>

                                    {deal.brief.suggestedImageUrl && (
                                        <div className="mb-md">
                                            <label className="text-xs text-muted">Suggested Image:</label>
                                            <img
                                                src={deal.brief.suggestedImageUrl}
                                                alt="Suggested"
                                                style={{
                                                    width: '100%',
                                                    maxHeight: '200px',
                                                    objectFit: 'cover',
                                                    borderRadius: 'var(--radius-md)',
                                                    marginTop: '4px'
                                                }}
                                            />
                                        </div>
                                    )}

                                    {deal.brief.suggestedText && (
                                        <div className="mb-sm">
                                            <label className="text-xs text-muted">Suggested Text:</label>
                                            <div className="p-sm mt-xs" style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap' }}>
                                                {deal.brief.suggestedText}
                                            </div>
                                        </div>
                                    )}
                                    {deal.brief.publishTime && (
                                        <div className="mb-sm">
                                            <label className="text-xs text-muted">Preferred Time:</label>
                                            <div className="text-sm">{formatDate(deal.brief.publishTime)} at {formatTime(deal.brief.publishTime)} (UTC)</div>
                                        </div>
                                    )}
                                    {deal.brief.additionalNotes && (
                                        <div className="mb-sm">
                                            <label className="text-xs text-muted">Notes:</label>
                                            <div className="text-sm text-secondary">{deal.brief.additionalNotes}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {isChannelOwner ? (
                                <div className="flex gap-sm">
                                    <button className="btn btn-success flex-1" onClick={handleAcceptDeal}>
                                        <Icon name="check" size={16} /> Accept
                                    </button>
                                    <button className="btn btn-danger flex-1" onClick={handleRejectDeal}>
                                        <Icon name="close" size={16} /> Reject
                                    </button>
                                </div>
                            ) : (
                                <p className="text-secondary text-center">
                                    Waiting for channel owner to accept this deal...
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Creative Revision - Show feedback and allow channel owner to resubmit */}
                {deal.status === 'creative_revision' && (
                    <div className="section">
                        <div className="card" style={{ borderColor: 'var(--accent-yellow)' }}>
                            <h4 className="mb-md"><Icon name="refresh" size={18} /> Revision Requested</h4>

                            {/* Show the latest feedback */}
                            {deal.creativeHistory && deal.creativeHistory.length > 0 && (
                                <div className="mb-md">
                                    <label className="text-xs text-muted">Feedback:</label>
                                    <div className="p-sm" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                                        {deal.creativeHistory[deal.creativeHistory.length - 1]?.feedback || 'No feedback provided'}
                                    </div>
                                </div>
                            )}

                            {isChannelOwner ? (
                                <button className="btn btn-primary btn-block" onClick={openCreativeModal}>
                                    <Icon name="edit" size={16} /> Submit Revised Creative
                                </button>
                            ) : (
                                <p className="text-secondary text-center">
                                    Waiting for channel owner to submit revised creative...
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Creative Section */}
                {['creative_pending', 'creative_submitted', 'creative_approved', 'scheduled', 'posted'].includes(deal.status) && (
                    <div className="section">
                        <h3 className="section-title mb-md"><Icon name="edit" size={18} /> Creative</h3>

                        {deal.creative ? (
                            <div className="card">
                                {/* Creative Image */}
                                {((deal.creative as any).mediaUrl || deal.creative.mediaUrls?.[0]) && (
                                    <div className="mb-md">
                                        <img
                                            src={(deal.creative as any).mediaUrl || deal.creative.mediaUrls?.[0]}
                                            alt="Creative"
                                            style={{
                                                width: '100%',
                                                maxHeight: '200px',
                                                objectFit: 'cover',
                                                borderRadius: 'var(--radius-md)'
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Creative Text */}
                                <div className="mb-md p-md" style={{
                                    background: 'var(--bg-secondary)',
                                    borderRadius: 'var(--radius-md)',
                                    whiteSpace: 'pre-wrap'
                                }}>
                                    {deal.creative.text}
                                </div>

                                {/* Scheduled Time */}
                                {deal.scheduledTime && (
                                    <div className="mb-md p-sm" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                                        <div className="flex items-center gap-sm">
                                            <Icon name="calendar" size={16} color="var(--accent-green)" />
                                            <span className="text-sm">
                                                <strong>Scheduled for:</strong> {formatDate((deal.scheduledTime as any)._seconds ? new Date((deal.scheduledTime as any)._seconds * 1000).toISOString() : deal.scheduledTime)} at {formatTime((deal.scheduledTime as any)._seconds ? new Date((deal.scheduledTime as any)._seconds * 1000).toISOString() : deal.scheduledTime)}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {deal.status === 'creative_submitted' && isAdvertiser && (
                                    <div className="flex gap-sm">
                                        <button
                                            className="btn btn-success flex-1"
                                            onClick={handleApproveCreative}
                                        >
                                            <Icon name="check" size={16} /> Approve
                                        </button>
                                        <button
                                            className="btn btn-secondary flex-1"
                                            onClick={() => setShowRevisionModal(true)}
                                        >
                                            <Icon name="refresh" size={16} /> Request Edits
                                        </button>
                                    </div>
                                )}

                                {deal.status === 'creative_approved' && isChannelOwner && (
                                    <div>
                                        <button
                                            className="btn btn-success btn-block mb-md"
                                            onClick={handlePostNow}
                                        >
                                            <Icon name="send" size={16} /> Post Now
                                        </button>

                                        <div className="text-muted text-center mb-sm text-xs">— أو جدولة للنشر لاحقاً —</div>

                                        <div className="form-group">
                                            <label className="form-label">Schedule Post Time</label>
                                            <input
                                                type="datetime-local"
                                                className="form-input"
                                                value={scheduledTime}
                                                onChange={e => setScheduledTime(e.target.value)}
                                                min={new Date().toISOString().slice(0, 16)}
                                            />
                                        </div>
                                        <button
                                            className="btn btn-secondary btn-block"
                                            onClick={handleSchedule}
                                            disabled={!scheduledTime}
                                        >
                                            <Icon name="calendar" size={16} /> Schedule Auto-Post
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="card">
                                {isChannelOwner && ['creative_pending'].includes(deal.status) ? (
                                    <div>
                                        {/* Show Brief from Advertiser */}
                                        {deal.brief && (
                                            <div className="mb-md p-md" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                                <h4 className="mb-sm" style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                                                    <Icon name="message" size={14} /> Advertiser's Brief
                                                </h4>

                                                {deal.brief.suggestedImageUrl && (
                                                    <div className="mb-md">
                                                        <label className="text-xs text-muted">Suggested Image:</label>
                                                        <img
                                                            src={deal.brief.suggestedImageUrl}
                                                            alt="Suggested"
                                                            style={{
                                                                width: '100%',
                                                                maxHeight: '200px',
                                                                objectFit: 'cover',
                                                                borderRadius: 'var(--radius-md)',
                                                                marginTop: '4px'
                                                            }}
                                                        />
                                                    </div>
                                                )}

                                                {deal.brief.suggestedText && (
                                                    <div className="mb-sm">
                                                        <label className="text-xs text-muted">Suggested Text:</label>
                                                        <div className="p-sm mt-xs" style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap' }}>
                                                            {deal.brief.suggestedText}
                                                        </div>
                                                    </div>
                                                )}

                                                {deal.brief.publishTime && (
                                                    <div className="mb-sm">
                                                        <label className="text-xs text-muted">Preferred Publish Time:</label>
                                                        <div className="text-sm">{formatDate(deal.brief.publishTime)} at {formatTime(deal.brief.publishTime)} (UTC)</div>
                                                    </div>
                                                )}

                                                {deal.brief.additionalNotes && (
                                                    <div className="mb-sm">
                                                        <label className="text-xs text-muted">Additional Notes:</label>
                                                        <div className="text-sm text-secondary">{deal.brief.additionalNotes}</div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <p className="text-secondary text-center mb-md">
                                            Create your ad creative based on the brief above.
                                        </p>
                                        <button
                                            className="btn btn-primary btn-block"
                                            onClick={openCreativeModal}
                                        >
                                            <Icon name="edit" size={16} /> Create Creative
                                        </button>
                                    </div>
                                ) : isAdvertiser && deal.status === 'creative_pending' ? (
                                    <p className="text-secondary text-center">
                                        Waiting for channel owner to submit creative...
                                    </p>
                                ) : (
                                    <p className="text-secondary text-center">
                                        No creative submitted yet.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Scheduled Info */}
                {deal.status === 'scheduled' && deal.scheduledTime && (
                    <div className="section">
                        <div className="card" style={{ borderColor: 'var(--accent-blue)' }}>
                            <h4 className="mb-sm"><Icon name="calendar" size={18} /> Scheduled</h4>
                            <p className="text-secondary">
                                Post will be published on {formatDate(deal.scheduledTime)} at {formatTime(deal.scheduledTime)} (UTC)
                            </p>
                        </div>
                    </div>
                )}

                {/* Posted Info */}
                {['posted', 'verified', 'completed'].includes(deal.status) && (
                    <div className="section">
                        <div className="card" style={{ borderColor: 'var(--accent-green)' }}>
                            <h4 className="mb-sm"><Icon name="check" size={18} /> {deal.status === 'completed' ? 'Completed' : 'Posted'}</h4>
                            {deal.postedAt && (
                                <p className="text-secondary">
                                    Posted on {formatDate(deal.postedAt)} at {formatTime(deal.postedAt)}
                                </p>
                            )}
                            {deal.status === 'posted' && (
                                <p className="text-sm text-muted mt-sm">
                                    Verifying post stays up for {deal.postDuration} hours...
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Message via Bot */}
                {!['completed', 'cancelled', 'refunded'].includes(deal.status) && (
                    <div className="section">
                        <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
                            <Icon name="message" size={24} color="var(--accent-blue)" />
                            <p className="text-secondary mt-sm mb-md" style={{ fontSize: '13px' }}>
                                Communicate with the other party through the bot.
                            </p>
                            <button
                                className="btn btn-secondary btn-block"
                                disabled={!botUsername}
                                onClick={() => {
                                    if (!botUsername) return;
                                    const tg = window.Telegram?.WebApp;
                                    if (tg?.openTelegramLink) {
                                        tg.openTelegramLink(`https://t.me/${botUsername}?start=msg_${deal.id}`);
                                    } else {
                                        window.open(`https://t.me/${botUsername}?start=msg_${deal.id}`, '_blank');
                                    }
                                }}
                            >
                                <Icon name="send" size={16} /> Message via Bot
                            </button>
                        </div>
                    </div>
                )}

                {/* Actions */}
                {!['completed', 'cancelled', 'refunded'].includes(deal.status) && (
                    <div className="section">
                        <div className="flex gap-sm">
                            {deal.status === 'posted' && isAdvertiser && (
                                <button
                                    className="btn btn-danger flex-1"
                                    onClick={handleDispute}
                                >
                                    <Icon name="warning" size={16} /> Dispute
                                </button>
                            )}

                            <button
                                className="btn btn-secondary flex-1"
                                onClick={handleCancel}
                            >
                                <Icon name="close" size={16} /> Cancel Deal
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Creative Modal */}
            {showCreativeModal && (
                <div className="modal-overlay" onClick={() => setShowCreativeModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Create Creative</h3>
                            <button className="modal-close" onClick={() => setShowCreativeModal(false)}>×</button>
                        </div>

                        {/* Image Upload/Preview */}
                        <div className="form-group">
                            <label className="form-label"><Icon name="image" size={14} /> Post Image</label>
                            {creativeImageUrl ? (
                                <div style={{ position: 'relative', marginBottom: 'var(--spacing-sm)' }}>
                                    <img
                                        src={creativeImageUrl}
                                        alt="Creative"
                                        style={{
                                            width: '100%',
                                            maxHeight: '150px',
                                            objectFit: 'cover',
                                            borderRadius: 'var(--radius-md)'
                                        }}
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        style={{
                                            position: 'absolute',
                                            top: '8px',
                                            right: '8px',
                                            padding: '4px 8px',
                                            fontSize: '12px'
                                        }}
                                        onClick={() => setCreativeImageUrl('')}
                                    >
                                        <Icon name="close" size={12} /> Change
                                    </button>
                                </div>
                            ) : (
                                <label className="btn btn-secondary btn-block" style={{ cursor: 'pointer' }}>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleCreativeImageUpload}
                                        style={{ display: 'none' }}
                                        disabled={isUploadingImage}
                                    />
                                    {isUploadingImage ? (
                                        <>Uploading...</>
                                    ) : (
                                        <><Icon name="upload" size={14} /> Upload Image</>
                                    )}
                                </label>
                            )}
                        </div>

                        {/* Post Text */}
                        <div className="form-group">
                            <label className="form-label"><Icon name="edit" size={14} /> Post Content</label>
                            <textarea
                                className="form-textarea"
                                placeholder="Write your ad post content..."
                                value={creativeText}
                                onChange={e => setCreativeText(e.target.value)}
                                rows={5}
                            />
                        </div>

                        {/* Publish Time */}
                        <div className="form-group">
                            <label className="form-label"><Icon name="calendar" size={14} /> Publish Time</label>
                            <input
                                type="datetime-local"
                                className="form-input"
                                value={creativeScheduledTime}
                                onChange={e => setCreativeScheduledTime(e.target.value)}
                                min={new Date().toISOString().slice(0, 16)}
                            />
                            <p className="text-xs text-muted mt-xs">
                                ⏰ All times are in UTC. The post will be published automatically at this time after advertiser approval.
                            </p>
                        </div>

                        <button
                            className="btn btn-primary btn-block"
                            onClick={handleSubmitCreative}
                            disabled={!creativeText.trim() || !creativeScheduledTime}
                        >
                            <Icon name="send" size={16} /> Submit for Review
                        </button>
                    </div>
                </div>
            )}

            {/* Revision Feedback Modal */}
            {showRevisionModal && (
                <div className="modal-overlay" onClick={() => setShowRevisionModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Request Edits</h3>
                            <button className="modal-close" onClick={() => setShowRevisionModal(false)}>×</button>
                        </div>

                        <div className="form-group">
                            <label className="form-label">What changes are needed?</label>
                            <textarea
                                className="form-textarea"
                                placeholder="Describe the changes you'd like the channel owner to make..."
                                value={revisionFeedback}
                                onChange={e => setRevisionFeedback(e.target.value)}
                                rows={4}
                            />
                        </div>

                        <p className="text-sm text-secondary mb-md">
                            The channel owner will receive your feedback and submit a revised version.
                        </p>

                        <button
                            className="btn btn-primary btn-block"
                            onClick={handleRequestRevision}
                            disabled={!revisionFeedback.trim()}
                        >
                            <Icon name="send" size={16} /> Send Feedback
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default DealDetail;
