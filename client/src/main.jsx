import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#1f2937',
          color: '#f9fafb',
          border: '1px solid #374151'
        },
        success: { iconTheme: { primary: '#10B981', secondary: '#1f2937' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#1f2937' } }
      }}
    />
  </React.StrictMode>
);
