import React from 'react';
import ReactDOM from 'react-dom/client';
import SimpleAdminPanel from './SimpleAdminPanel.jsx';
import AuthGate from './AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate sadeceAdmin>
      <SimpleAdminPanel />
    </AuthGate>
  </React.StrictMode>,
);
