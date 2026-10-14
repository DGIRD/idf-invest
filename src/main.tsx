import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { config, isDemoMode } from './config.ts';
import { createDemoRepo } from './data/demoRepo.ts';
import { createSupabaseRepo } from './data/supabaseRepo.ts';
import { StoreProvider } from './data/store.tsx';
import './styles.css';

const repo = isDemoMode() ? createDemoRepo() : createSupabaseRepo(config.supabaseUrl, config.supabaseAnonKey);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider repo={repo}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && config.env !== 'development') {
  addEventListener('load', () => { void navigator.serviceWorker.register('service-worker.js'); });
}
