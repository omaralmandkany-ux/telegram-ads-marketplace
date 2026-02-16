// My Channels Page

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, Channel } from '../lib/api';
import Header from '../components/Header';
import ChannelCard from '../components/ChannelCard';
import EmptyState from '../components/EmptyState';
import Loading from '../components/Loading';
import Icon from '../components/Icon';

function MyChannels() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();

    const [channels, setChannels] = useState<Channel[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadChannels();
    }, []);

    const loadChannels = async () => {
        setIsLoading(true);
        try {
            const response = await api.get<Channel[]>('/channels/mine');
            if (response.success) {
                setChannels(response.data || []);
            }
        } catch (error) {
            console.error('Error loading channels:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <Header
                title="My Channels"
                action={{
                    label: <><Icon name="plus" size={14} /> Add</>,
                    onClick: () => {
                        hapticFeedback('light');
                        navigate('/channels/new');
                    }
                }}
            />

            <div className="container">
                {isLoading ? (
                    <Loading />
                ) : channels.length === 0 ? (
                    <EmptyState
                        icon="megaphone"
                        title="No channels yet"
                        message="Register your first channel to start accepting ad placements."
                        action={{
                            label: <><Icon name="plus" size={14} /> Register Channel</>,
                            onClick: () => {
                                hapticFeedback('light');
                                navigate('/channels/new');
                            }
                        }}
                    />
                ) : (
                    <div className="section">
                        <div className="flex flex-col gap-sm">
                            {channels.map(channel => (
                                <div key={channel.id} className="card">
                                    <ChannelCard channel={channel} showPrice={false} />

                                    <div className="mt-md p-md" style={{
                                        background: channel.botIsAdmin
                                            ? 'rgba(34, 197, 94, 0.1)'
                                            : 'rgba(245, 158, 11, 0.1)',
                                        borderRadius: 'var(--radius-md)'
                                    }}>
                                        <p className={`text-sm mb-sm ${channel.botIsAdmin ? 'text-success' : 'text-warning'}`}>
                                            {channel.botIsAdmin
                                                ? <><Icon name="checkCircle" size={14} /> Bot is admin - Channel is visible on marketplace</>
                                                : <><Icon name="warning" size={14} /> Bot is not an admin of this channel. Add the bot as admin with posting permissions.</>}
                                        </p>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={async () => {
                                                hapticFeedback('light');
                                                try {
                                                    const result = await api.get(`/channels/${channel.id}/verify-bot`);
                                                    console.log('Verify bot result:', result);
                                                    loadChannels();
                                                } catch (error) {
                                                    console.error('Error verifying bot:', error);
                                                }
                                            }}
                                        >
                                            <Icon name="refresh" size={14} /> Check Bot Status
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default MyChannels;
