// Request Detail Page

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import { api, AdRequest, Channel } from '../lib/api';
import Header from '../components/Header';
import ChannelCard from '../components/ChannelCard';
import Loading from '../components/Loading';
import Icon from '../components/Icon';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';

function RequestDetail() {
    const { requestId } = useParams<{ requestId: string }>();
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();
    const { user } = useAuth();
    const { showConfirm } = useConfirm();
    const { showSuccess, showError } = useToast();

    const [request, setRequest] = useState<AdRequest | null>(null);
    const [applicants, setApplicants] = useState<Channel[]>([]);
    const [myChannels, setMyChannels] = useState<Channel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showApplyModal, setShowApplyModal] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState('');
    const [proposedPrice, setProposedPrice] = useState('');

    const isOwner = request?.advertiserId === user?.id;

    useEffect(() => {
        loadRequest();
    }, [requestId]);

    const loadRequest = async () => {
        if (!requestId) return;

        setIsLoading(true);
        try {
            const [requestRes, channelsRes] = await Promise.all([
                api.get<AdRequest>(`/requests/${requestId}`),
                api.get<Channel[]>('/channels/mine'),
            ]);

            if (requestRes.success && requestRes.data) {
                setRequest(requestRes.data);
                setProposedPrice(requestRes.data.budget.min.toString());

                // Load applicants if owner
                if (requestRes.data.advertiserId === user?.id) {
                    const applicantsRes = await api.get<Channel[]>(`/requests/${requestId}/applicants`);
                    if (applicantsRes.success) {
                        setApplicants(applicantsRes.data || []);
                    }
                }
            }

            if (channelsRes.success) {
                setMyChannels(channelsRes.data || []);
                if ((channelsRes.data || []).length > 0) {
                    setSelectedChannel((channelsRes.data || [])[0].id);
                }
            }
        } catch (error) {
            console.error('Error loading request:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleApply = async () => {
        if (!request || !selectedChannel) return;

        hapticFeedback('medium');

        try {
            const response = await api.post(`/requests/${request.id}/apply`, {
                channelId: selectedChannel,
                proposedPrice: parseFloat(proposedPrice),
            });

            if (response.success) {
                hapticFeedback('success');
                showSuccess('Application submitted successfully!');
                setShowApplyModal(false);
                loadRequest();
            } else {
                hapticFeedback('error');
                showError(response.error || 'Failed to apply');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to apply');
        }
    };

    const handleCreateDeal = async (channelId: string) => {
        if (!request) return;

        hapticFeedback('medium');

        const confirmed = await showConfirm({ message: 'Accept this channel for the deal?', confirmText: 'Accept', type: 'success' });
        if (!confirmed) return;

        try {
            const response = await api.post('/deals', {
                channelId,
                sourceType: 'request',
                sourceId: request.id,
                amount: request.budget.min,
                format: request.preferredFormat,
            });

            if (response.success && response.data) {
                hapticFeedback('success');
                navigate(`/deals/${(response.data as any).id}`);
            } else {
                hapticFeedback('error');
                showError(response.error || 'Failed to create deal');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to create deal');
        }
    };

    const handleCancelRequest = async () => {
        if (!request) return;

        hapticFeedback('medium');

        const confirmed = await showConfirm({
            message: 'Are you sure you want to cancel this request?',
            confirmText: 'Cancel Request',
            type: 'danger'
        });
        if (!confirmed) return;

        try {
            const response = await api.put(`/requests/${request.id}`, {
                status: 'cancelled',
            });

            if (response.success) {
                hapticFeedback('success');
                showSuccess('Request cancelled successfully');
                navigate('/requests');
            } else {
                hapticFeedback('error');
                showError(response.error || 'Failed to cancel request');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to cancel request');
        }
    };

    if (isLoading) return <Loading />;

    if (!request) {
        return (
            <div>
                <Header title="Request" showBack />
                <div className="container">
                    <div className="empty-state">
                        <div className="empty-state-icon"><Icon name="close" size={48} /></div>
                        <h3 className="empty-state-title">Request not found</h3>
                    </div>
                </div>
            </div>
        );
    }

    // Check if user has already applied
    const alreadyApplied = myChannels.some(ch => request.applicants.includes(ch.id));

    return (
        <div>
            <Header title="Request Details" showBack backTo="/requests" />

            <div className="container animate-fadeIn">
                {/* Request Info */}
                <div className="section">
                    <div className="card">
                        <div className="flex justify-between items-start mb-md">
                            <h2 className="text-xl">{request.title}</h2>
                            <span className={`badge badge-${request.status === 'active' ? 'success' : 'warning'}`}>
                                {request.status}
                            </span>
                        </div>

                        {request.advertiser && (
                            <div className="text-sm text-secondary mb-md">
                                by {request.advertiser.firstName}
                                {request.advertiser.username && ` (@${request.advertiser.username})`}
                            </div>
                        )}

                        <p className="text-secondary mb-lg">{request.description}</p>

                        <div className="grid grid-cols-2 gap-md mb-md">
                            <div>
                                <div className="text-xs text-muted mb-xs">Budget</div>
                                <div className="font-semibold">
                                    {request.budget.min === request.budget.max
                                        ? `${request.budget.min} TON`
                                        : `${request.budget.min} - ${request.budget.max} TON`}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-muted mb-xs">Format</div>
                                <div className="font-semibold">{request.preferredFormat}</div>
                            </div>
                        </div>

                        {request.targetAudience && (
                            <div className="mb-md">
                                <div className="text-xs text-muted mb-xs">Target Audience</div>
                                <div className="text-secondary">{request.targetAudience}</div>
                            </div>
                        )}

                        {request.requirements && (
                            <div className="mb-md">
                                <div className="text-xs text-muted mb-xs">Requirements</div>
                                <div className="text-secondary">{request.requirements}</div>
                            </div>
                        )}

                        <div className="flex gap-md">
                            {request.minSubscribers && (
                                <span className="badge badge-info">Min {request.minSubscribers} subs</span>
                            )}
                            {request.maxSubscribers && (
                                <span className="badge badge-info">Max {request.maxSubscribers} subs</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Applicants (for owner) */}
                {isOwner && (
                    <div className="section">
                        <h3 className="section-title mb-md">
                            Applicants ({applicants.length})
                        </h3>

                        {applicants.length === 0 ? (
                            <div className="card text-center">
                                <p className="text-secondary">No applications yet. Share your request to get more visibility.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {applicants.map(channel => (
                                    <div key={channel.id} className="card">
                                        <ChannelCard channel={channel} showPrice={false} />
                                        <button
                                            className="btn btn-primary btn-block mt-md"
                                            onClick={() => handleCreateDeal(channel.id)}
                                        >
                                            <Icon name="check" size={16} /> Accept & Create Deal
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Cancel Request Button */}
                        {request.status === 'active' && (
                            <button
                                className="btn btn-danger btn-block mt-lg"
                                onClick={handleCancelRequest}
                            >
                                <Icon name="close" size={16} /> Cancel Request
                            </button>
                        )}
                    </div>
                )}

                {/* Apply Button (for non-owners with channels) */}
                {!isOwner && myChannels.length > 0 && (
                    <div className="section">
                        {alreadyApplied ? (
                            <div className="card text-center">
                                <p className="text-success"><Icon name="checkCircle" size={14} /> You have already applied with a channel</p>
                            </div>
                        ) : (
                            <button
                                className="btn btn-primary btn-lg btn-block"
                                onClick={() => setShowApplyModal(true)}
                            >
                                <Icon name="list" size={16} /> Apply with My Channel
                            </button>
                        )}
                    </div>
                )}

                {/* No channels message */}
                {!isOwner && myChannels.length === 0 && (
                    <div className="section">
                        <div className="card text-center">
                            <p className="text-secondary mb-md">Register a channel to apply for this request.</p>
                            <button
                                className="btn btn-primary"
                                onClick={() => navigate('/channels/new')}
                            >
                                <Icon name="plus" size={14} /> Register Channel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Apply Modal */}
            {showApplyModal && (
                <div className="modal-overlay" onClick={() => setShowApplyModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Apply to Request</h3>
                            <button className="modal-close" onClick={() => setShowApplyModal(false)}>×</button>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Select Channel</label>
                            <select
                                className="form-select"
                                value={selectedChannel}
                                onChange={e => setSelectedChannel(e.target.value)}
                            >
                                {myChannels.map(channel => (
                                    <option key={channel.id} value={channel.id}>
                                        @{channel.username || channel.title}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Proposed Price (TON)</label>
                            <input
                                type="number"
                                className="form-input"
                                value={proposedPrice}
                                onChange={e => setProposedPrice(e.target.value)}
                                min="0.1"
                                step="0.1"
                            />
                        </div>

                        <button
                            className="btn btn-primary btn-block"
                            onClick={handleApply}
                            disabled={!selectedChannel}
                        >
                            <Icon name="fileText" size={16} /> Submit Application
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RequestDetail;
