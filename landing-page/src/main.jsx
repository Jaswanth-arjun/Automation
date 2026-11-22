import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installMaintenanceWatch } from './lib/maintenance';
import './style.css';

installMaintenanceWatch();

createRoot(document.getElementById('root')).render(<App />);
