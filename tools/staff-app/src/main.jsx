import React from 'react'
import ReactDOM from 'react-dom/client'
import SimpleAppWithAuth from './SimpleAppWithAuth.jsx'
import SunucuDurumu from './SunucuDurumu.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SimpleAppWithAuth />
    <SunucuDurumu />
  </React.StrictMode>
)

