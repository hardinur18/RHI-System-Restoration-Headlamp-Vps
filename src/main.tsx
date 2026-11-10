import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import { ErrorBoundary } from './app/components/ErrorBoundary'
import { pwaUpdates, registerPwaUpdateService } from './app/services/pwaUpdateService'
import {
  DOM_MUTATION_RELOAD_MARKER,
  installReactDomMutationGuard,
  isReactDomRemovalError,
  isStaleChunkError,
  reloadOnce,
} from './app/errors/recoverableErrors'
import { installGlobalErrorReportingHandlers } from './app/services/errorTelemetry'
import './styles/theme.css'
import './styles/fonts.css'
import './styles/globals.css'
import './styles/foundation.css'
import './styles/migration-preview.css'

const LOCAL_RUNTIME_RESET_MARKER = 'rhi-local-runtime-cache-reset-v2'

async function clearLocalRuntimeCaches(isLocalDev: boolean) {
  if (typeof window === 'undefined' || !isLocalDev) return false

  let cleared = false

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    cleared = cleared || registrations.length > 0
  }

  if ('caches' in window) {
    const keys = await window.caches.keys()
    await Promise.all(keys.map((key) => window.caches.delete(key)))
    cleared = cleared || keys.length > 0
  }

  return cleared
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

if (typeof window !== 'undefined') {
  const hostname = window.location.hostname
  const isLocalDev =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0'
  const themeResetMarker = 'rhi-system-theme-reset-v1'

  installReactDomMutationGuard()
  installGlobalErrorReportingHandlers({
    shouldIgnore: (error) => isReactDomRemovalError(error) || isStaleChunkError(error),
  })

  document.documentElement.classList.add('notranslate')
  document.documentElement.setAttribute('translate', 'no')
  document.body.classList.add('notranslate')
  document.body.setAttribute('translate', 'no')
  document.getElementById('root')?.setAttribute('translate', 'no')

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    pwaUpdates.requestReload()
  })

  window.addEventListener('error', (event) => {
    if (!isReactDomRemovalError(event.error || event.message)) return

    event.preventDefault()
    reloadOnce(DOM_MUTATION_RELOAD_MARKER)
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!isReactDomRemovalError(event.reason)) return

    event.preventDefault()
    reloadOnce(DOM_MUTATION_RELOAD_MARKER)
  })

  if (!isLocalDev && import.meta.env.PROD) {
    registerPwaUpdateService()
  }

  if (isLocalDev && !window.localStorage.getItem(themeResetMarker)) {
    window.localStorage.removeItem('theme')
    window.localStorage.removeItem('rhi-system-theme')
    window.localStorage.setItem(themeResetMarker, 'done')
    document.documentElement.classList.remove('dark')
    document.body.classList.remove('dark')
    document.documentElement.style.colorScheme = 'light'
    document.body.style.colorScheme = 'light'
  }

  if (isLocalDev) {
    void clearLocalRuntimeCaches(isLocalDev)
      .then((cleared) => {
        if (cleared && window.sessionStorage.getItem(LOCAL_RUNTIME_RESET_MARKER) !== 'done') {
          window.sessionStorage.setItem(LOCAL_RUNTIME_RESET_MARKER, 'done')
          window.location.reload()
          return
        }

        renderApp()
      })
      .catch(() => {
        renderApp()
      })
  } else {
    renderApp()
  }
} else {
  renderApp()
}
