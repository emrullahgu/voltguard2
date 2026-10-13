import React from 'react';
import ReactDOM from 'react-dom/client';
import PeriyodikKontrol from './PeriyodikKontrol.jsx';
import AuthGate from './AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <PeriyodikKontrol />
    </AuthGate>
  </React.StrictMode>,
);
