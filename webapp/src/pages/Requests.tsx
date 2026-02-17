// Requests Page - Browse ad requests

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, AdRequest } from '../lib/api';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import Loading from '../components/Loading';

function Requests() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();

    const [requests, setRequests] = useState<AdRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'mine'>('all');

    useEffect(() => {
        loadRequests();
    }, [filter]);

    const loadRequests = async () => {
        setIsLoading(true);
        try {
            const endpoint = filter === 'mine' ? '/requests/mine' : '/requests';
            const response = await api.get<{ data: AdRequest[] }>(endpoint);

            if (response.success && response.data) {
                const rawData = response.data as any;
                setRequests(rawData.data || rawData || []);
            }
        } catch (error) {
            console.error('Error loading requests:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>

            <div className="container">
                {/* Create Button */}
                <div className="section" style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 0, marginBottom: 0 }}>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                            hapticFeedback('light');
                            navigate('/requests/new');
                        }}
                    >
                        <Icon name="plus" size={14} /> Create
                    </button>
                </div>

                {/* Filter Tabs */}
                <div className="section">
                    <div className="flex gap-sm">
                        <button
                            className={`btn flex-1 ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFilter('all')}
                        >
                            All Requests
                        </button>
                        <button
                            className={`btn flex-1 ${filter === 'mine' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFilter('mine')}
                        >
                            My Requests
                        </button>
                    </div>
                </div>

                {/* Results */}
                {isLoading ? (
                    <Loading />
                ) : requests.length === 0 ? (
                    <EmptyState
                        icon="requests"
                        title={filter === 'mine' ? "No requests yet" : "No active requests"}
                        message={filter === 'mine'
                            ? "Create your first ad request to start receiving applications from channels."
                            : "Check back later for new ad requests."
                        }
                        action={{
                            label: <><Icon name="plus" size={14} /> Create Request</>,
                            onClick: () => {
                                hapticFeedback('light');
                                navigate('/requests/new');
                            }
                        }}
                    />
                ) : (
                    <div className="section">
                        <div className="flex flex-col gap-sm">
                            {requests.map(request => (
                                <Link key={request.id} to={`/requests/${request.id}`} className="card card-clickable">
                                    <div className="flex justify-between items-start mb-sm">
                                        <div className="flex-1">
                                            <div className="font-semibold mb-xs">{request.title}</div>
                                            {request.advertiser && (
                                                <div className="text-sm text-secondary">
                                                    by {request.advertiser.firstName}
                                                    {request.advertiser.username && ` (@${request.advertiser.username})`}
                                                </div>
                                            )}
                                        </div>
                                        <span className={`badge badge-${request.status === 'active' ? 'success' : 'warning'}`}>
                                            {request.status}
                                        </span>
                                    </div>

                                    <p className="text-sm text-secondary mb-md" style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                    }}>
                                        {request.description}
                                    </p>

                                    <div className="flex justify-between items-center">
                                        <div className="flex gap-md">
                                            <span className="price-tag price-tag-ton">
                                                <Icon name="ton" size={14} /> {request.budget.min === request.budget.max
                                                    ? `${request.budget.min} TON`
                                                    : `${request.budget.min}-${request.budget.max} TON`}
                                            </span>
                                            <span className="badge badge-info">{request.preferredFormat}</span>
                                        </div>
                                        <span className="text-xs text-muted">
                                            {request.applicants.length} applicant{request.applicants.length !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Requests;
