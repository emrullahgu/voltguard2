import React from 'react';
import ReactDOM from 'react-dom/client';
import BeyazYakaBordro from './BeyazYakaBordro';
import AuthGate from './AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <BeyazYakaBordro />
    </AuthGate>
  </React.StrictMode>
);
