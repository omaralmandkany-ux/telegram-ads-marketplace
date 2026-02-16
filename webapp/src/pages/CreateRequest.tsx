import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, AdRequest } from '../lib/api';
import Header from '../components/Header';
import Icon from '../components/Icon';

function CreateRequest() {
    const navigate = useNavigate();
    const { hapticFeedback, showAlert } = useTelegram();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [budgetMin, setBudgetMin] = useState('');
    const [budgetMax, setBudgetMax] = useState('');
    const [preferredFormat, setPreferredFormat] = useState<'post' | 'story' | 'forward'>('post');
    const [targetAudience, setTargetAudience] = useState('');
    const [requirements, setRequirements] = useState('');
    const [minSubscribers, setMinSubscribers] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Image upload state
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                setError('Image size must be less than 5MB');
                return;
            }

            // Validate file type
            if (!file.type.startsWith('image/')) {
                setError('Please select an image file');
                return;
            }

            setError('');

            // Create preview
            const reader = new FileReader();
            reader.onload = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = () => {
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title || !description || !budgetMin) {
            setError('Title, description, and budget are required');
            return;
        }

        setIsLoading(true);
        setError('');
        hapticFeedback('light');

        try {
            const requestData: any = {
                title,
                description,
                budget: {
                    min: parseFloat(budgetMin),
                    max: parseFloat(budgetMax || budgetMin),
                },
                preferredFormat,
            };

            if (targetAudience) requestData.targetAudience = targetAudience;
            if (requirements) requestData.requirements = requirements;
            if (minSubscribers) requestData.minSubscribers = parseInt(minSubscribers);

            // Add image if selected
            if (imagePreview) {
                requestData.imageBase64 = imagePreview;
            }

            const response = await api.post<AdRequest>('/requests', requestData);

            if (response.success && response.data) {
                hapticFeedback('success');
                await showAlert('Ad request created successfully!');
                navigate(`/requests/${response.data.id}`);
            } else {
                hapticFeedback('error');
                setError(response.error || 'Failed to create request');
            }
        } catch (err: any) {
            hapticFeedback('error');
            setError(err.message || 'Failed to create request');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <Header title="Create Ad Request" showBack backTo="/requests" />

            <div className="container animate-fadeIn">
                <form onSubmit={handleSubmit}>
                    {/* Basic Info */}
                    <div className="section">
                        <h3 className="section-title mb-md"><Icon name="list" size={18} /> Basic Information</h3>

                        <div className="form-group">
                            <label className="form-label">Title *</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="e.g., Promote our new app"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Description *</label>
                            <textarea
                                className="form-textarea"
                                placeholder="Describe your campaign goals, product, and what you're looking for..."
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                disabled={isLoading}
                                rows={4}
                            />
                        </div>

                        {/* Image Upload */}
                        <div className="form-group">
                            <label className="form-label">
                                <Icon name="image" size={16} /> Ad Image (Optional)
                            </label>

                            <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/*"
                                onChange={handleImageSelect}
                                disabled={isLoading}
                                style={{ display: 'none' }}
                            />

                            {imagePreview ? (
                                <div className="image-preview-container">
                                    <img
                                        src={imagePreview}
                                        alt="Preview"
                                        className="image-preview"
                                    />
                                    <button
                                        type="button"
                                        className="image-remove-btn"
                                        onClick={removeImage}
                                        disabled={isLoading}
                                    >
                                        <Icon name="close" size={16} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="image-upload-btn"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isLoading}
                                >
                                    <Icon name="plus" size={24} />
                                    <span>Add Image</span>
                                </button>
                            )}
                            <p className="form-hint">Upload an image for your ad (max 5MB)</p>
                        </div>
                    </div>

                    {/* Budget & Format */}
                    <div className="section">
                        <h3 className="section-title mb-md"><Icon name="coins" size={18} /> Budget & Format</h3>

                        <div className="grid grid-cols-2 gap-md">
                            <div className="form-group">
                                <label className="form-label">Min Budget (TON) *</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    placeholder="10"
                                    value={budgetMin}
                                    onChange={e => setBudgetMin(e.target.value)}
                                    min="0.1"
                                    step="0.1"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Max Budget (TON)</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    placeholder="100"
                                    value={budgetMax}
                                    onChange={e => setBudgetMax(e.target.value)}
                                    min="0.1"
                                    step="0.1"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Preferred Format</label>
                            <select
                                className="form-select"
                                value={preferredFormat}
                                onChange={e => setPreferredFormat(e.target.value as any)}
                                disabled={isLoading}
                            >
                                <option value="post">Post</option>
                                <option value="story">Story</option>
                                <option value="forward">Forward</option>
                            </select>
                        </div>
                    </div>

                    {/* Target Audience */}
                    <div className="section">
                        <h3 className="section-title mb-md"><Icon name="target" size={18} /> Targeting (Optional)</h3>

                        <div className="form-group">
                            <label className="form-label">Target Audience</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="e.g., Crypto enthusiasts, tech lovers"
                                value={targetAudience}
                                onChange={e => setTargetAudience(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Min Subscribers</label>
                            <input
                                type="number"
                                className="form-input"
                                placeholder="1000"
                                value={minSubscribers}
                                onChange={e => setMinSubscribers(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Requirements</label>
                            <textarea
                                className="form-textarea"
                                placeholder="Any specific requirements for the channel or post..."
                                value={requirements}
                                onChange={e => setRequirements(e.target.value)}
                                disabled={isLoading}
                            />
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
                            disabled={isLoading || !title || !description || !budgetMin}
                        >
                            {isLoading ? 'Creating...' : <><Icon name="check" size={18} /> Create Ad Request</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CreateRequest;
