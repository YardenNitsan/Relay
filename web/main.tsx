import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';
import App from './App';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Content and credentials are never logged by the browser boundary. */ }
  render() {
    if (this.state.failed) return <main className="fatal"><h1>The interface could not continue</h1><p>Your persisted conversations remain with the local service. Reload to reconnect.</p><button onClick={() => window.location.reload()}>Reload Relay</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppBoundary><QueryClientProvider client={client}><App /></QueryClientProvider></AppBoundary></StrictMode>);
