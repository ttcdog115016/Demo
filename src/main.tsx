import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// 確保在 App 之前引入
import './i18n'; 
import App from './App.tsx'
import { VercelToolbar } from './VercelToolbar.tsx' // 👉 引入 VercelToolbar


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <VercelToolbar />
  </StrictMode>,
)
