import React from 'react';
import ReactDOM from 'react-dom/client';
import AkaryakitTakip from './AkaryakitTakip.jsx';
import AuthGate from './AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <AkaryakitTakip />
    </AuthGate>
  </React.StrictMode>,
);
