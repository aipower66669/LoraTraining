import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last-resort net for crashes outside the routed screens (e.g. the header/nav itself). */}
    <ErrorBoundary label="LoraTraining">
      <App />
    </ErrorBoundary>
  </StrictMode>
)
