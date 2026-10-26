import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from './App';
import { createApp } from './createApp';
import './styles/index.css';

const { queryClient, router } = createApp();

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} router={router}>
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </App>
  </StrictMode>,
);
