import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import './styles/ui.css'
import App from './App.tsx'

const noFxEnabled =
  new URLSearchParams(window.location.search).get('noFx') === '1' ||
  import.meta.env.VITE_NO_FX === '1'

if (noFxEnabled) {
  document.documentElement.classList.add('no-fx')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.error('Service worker registration failed:', error)
    })
  })
}
