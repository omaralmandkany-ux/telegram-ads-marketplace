// Main App Component with Routing

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useTelegram } from './contexts/TelegramContext';

// Layout
import Layout from './components/Layout';
import Loading from './components/Loading';

// Pages
import Home from './pages/Home';
import Channels from './pages/Channels';
import ChannelDetail from './pages/ChannelDetail';
import MyChannels from './pages/MyChannels';
import RegisterChannel from './pages/RegisterChannel';
import Requests from './pages/Requests';
import RequestDetail from './pages/RequestDetail';
import CreateRequest from './pages/CreateRequest';
import Deals from './pages/Deals';
import DealDetail from './pages/DealDetail';
import Wallet from './pages/Wallet';
import Admin from './pages/Admin';

function App() {
    const { isReady } = useTelegram();
    const { isLoading } = useAuth();

    // Show loading while Telegram SDK or auth is initializing
    if (!isReady || isLoading) {
        return <Loading message="Loading..." />;
    }

    return (
        <Layout>
            <Routes>
                {/* Home / Dashboard */}
                <Route path="/" element={<Home />} />

                {/* Channels */}
                <Route path="/channels" element={<Channels />} />
                <Route path="/channels/new" element={<RegisterChannel />} />
                <Route path="/channels/:channelId" element={<ChannelDetail />} />
                <Route path="/my-channels" element={<MyChannels />} />

                {/* Ad Requests */}
                <Route path="/requests" element={<Requests />} />
                <Route path="/requests/new" element={<CreateRequest />} />
                <Route path="/requests/:requestId" element={<RequestDetail />} />

                {/* Deals */}
                <Route path="/deals" element={<Deals />} />
                <Route path="/deals/:dealId" element={<DealDetail />} />

                {/* Wallet */}
                <Route path="/wallet" element={<Wallet />} />

                {/* Admin */}
                <Route path="/admin" element={<Admin />} />

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Layout>
    );
}

export default App;
