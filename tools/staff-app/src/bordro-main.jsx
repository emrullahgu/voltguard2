import React from 'react';
import ReactDOM from 'react-dom/client';
import { BordroWithPassword } from './BordroWithPassword.jsx';
import AuthGate from './AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <BordroWithPassword />
    </AuthGate>
  </React.StrictMode>,
);

