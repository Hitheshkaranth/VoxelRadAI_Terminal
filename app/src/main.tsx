import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/ui.css'
import './index.css'
import App from './App.tsx'
import './styles/workspace.css'
import './styles/mobile.css'
import './styles/clinical.css'
import './styles/material.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
