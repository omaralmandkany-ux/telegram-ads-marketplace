// Loading Component

interface LoadingProps {
    message?: string;
}

function Loading({ message = 'Loading...' }: LoadingProps) {
    return (
        <div className="loading" style={{ minHeight: '100vh' }}>
            <div className="flex flex-col items-center gap-md">
                <div className="spinner"></div>
                <p className="text-secondary">{message}</p>
            </div>
        </div>
    );
}

export default Loading;
