// Register Channel Page

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, Channel } from '../lib/api';
import Header from '../components/Header';
import CustomSelect from '../components/CustomSelect';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';

const durationOptions = [
    { value: '12h', label: '12 hours', icon: 'timer' },
    { value: '24h', label: '24 hours', icon: 'timer' },
    { value: '48h', label: '48 hours', icon: 'timer' },
    { value: '72h', label: '72 hours', icon: 'timer' },
    { value: '1w', label: '1 week', icon: 'calendar' },
    { value: 'forever', label: 'Forever', icon: 'infinity' },
];

const categoryOptions = [
    { value: 'general', label: 'General', icon: 'megaphone' },
    { value: 'crypto', label: 'Crypto', icon: 'dollar' },
    { value: 'tech', label: 'Tech', icon: 'settings' },
    { value: 'lifestyle', label: 'Lifestyle', icon: 'star' },
    { value: 'news', label: 'News', icon: 'fileText' },
    { value: 'entertainment', label: 'Entertainment', icon: 'eye' },
    { value: 'education', label: 'Education', icon: 'info' },
];

function RegisterChannel() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();
    const { showSuccess, showError } = useToast();

    const [channelUsername, setChannelUsername] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('general');
    const [postPrice, setPostPrice] = useState('');
    const [postDuration, setPostDuration] = useState('24h');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!channelUsername) {
            setError('Channel username is required');
            return;
        }

        setIsLoading(true);
        setError('');
        hapticFeedback('light');

        try {
            const pricing: any = {};

            if (postPrice) {
                pricing.post = {
                    price: parseFloat(postPrice),
                    duration: postDuration,
                };
            }

            const response = await api.post<Channel>('/channels', {
                channelUsername: channelUsername.replace('@', ''),
                description,
                category,
                pricing,
            });

            if (response.success && response.data) {
                hapticFeedback('success');
                showSuccess('Channel registered successfully!');
                navigate(`/channels/${response.data.id}`);
            } else {
                hapticFeedback('error');
                showError(response.error || 'Failed to register channel');
                setError(response.error || 'Failed to register channel');
            }
        } catch (err: any) {
            hapticFeedback('error');
            showError(err.message || 'Failed to register channel');
            setError(err.message || 'Failed to register channel');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <Header title="Register Channel" showBack backTo="/my-channels" />

            <div className="container animate-fadeIn">
                {/* Instructions */}
                <div className="section">
                    <div className="card">
                        <h3 className="mb-md"><Icon name="fileText" size={18} /> Before you begin</h3>
                        <ol className="text-secondary" style={{ paddingLeft: '20px' }}>
                            <li className="mb-sm">Add <a href="https://t.me/PHo_iraq" target="_blank" rel="noopener noreferrer" style={{ color: '#00aaff', textDecoration: 'none', fontWeight: 600 }}>@PHo_iraq</a> as an <strong>admin</strong> to your channel</li>
                            <li className="mb-sm">Give it <strong>Post Messages</strong> permission</li>
                            <li>Enter your channel username below</li>
                        </ol>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="section">
                        <div className="form-group">
                            <label className="form-label">Channel Username *</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="@yourchannel"
                                value={channelUsername}
                                onChange={e => setChannelUsername(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Description (optional)</label>
                            <textarea
                                className="form-textarea"
                                placeholder="Describe your channel and audience..."
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Category *</label>
                            <CustomSelect
                                options={categoryOptions}
                                value={category}
                                onChange={setCategory}
                            />
                        </div>
                    </div>

                    <div className="section">
                        <h3 className="section-title mb-md"><Icon name="dollar" size={18} /> Pricing</h3>

                        <div className="card">
                            <h4 className="mb-md">Post Ad</h4>
                            <div className="grid grid-cols-2 gap-md">
                                <div className="form-group mb-0">
                                    <label className="form-label">Price (TON)</label>
                                    <input
                                        type="number"
                                        className="form-input"
                                        placeholder="10"
                                        value={postPrice}
                                        onChange={e => setPostPrice(e.target.value)}
                                        min="0.1"
                                        step="0.1"
                                        disabled={isLoading}
                                    />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">Duration</label>
                                    <CustomSelect
                                        options={durationOptions}
                                        value={postDuration}
                                        onChange={setPostDuration}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="section">
                            <div className="card" style={{ borderColor: 'var(--accent-red)' }}>
                                <p className="text-danger">{error}</p>
                            </div>
                        </div>
                    )}

                    <div className="section">
                        <button
                            type="submit"
                            className="btn btn-primary btn-lg btn-block"
                            disabled={isLoading || !channelUsername}
                        >
                            {isLoading ? 'Registering...' : <><Icon name="megaphone" size={18} /> Register Channel</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default RegisterChannel;
