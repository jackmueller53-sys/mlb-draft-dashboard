import React from 'react'
import ReactDOM from 'react-dom/client'
// HashRouter over BrowserRouter — GitHub Pages doesn't natively support SPA
// history-mode fallback, so hash routing (URLs become "…/#/simulator") stays
// bulletproof on the free static host without server-side rewrites.
import { HashRouter as BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
