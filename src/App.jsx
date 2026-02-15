import { useState, useCallback, useEffect } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import { apiCheckSession, apiLogout } from './api.js'
import './App.css'

function App() {
  const [view, setView] = useState(() => {
    return localStorage.getItem('fellis_logged_in') ? 'platform' : 'landing'
  })
  const [lang, setLang] = useState(() => {
    return localStorage.getItem('fellis_lang') || 'da'
  })

  // On mount: check for Facebook OAuth callback or validate existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fbSession = params.get('fb_session')
    const fbLang = params.get('fb_lang')

    if (fbSession) {
      // Returning from Facebook OAuth — store session and enter platform
      localStorage.setItem('fellis_session_id', fbSession)
      localStorage.setItem('fellis_logged_in', 'true')
      if (fbLang) {
        localStorage.setItem('fellis_lang', fbLang)
        setLang(fbLang)
      }
      setView('platform')
      // Clean up URL params
      window.history.replaceState({}, '', window.location.pathname)
      return
    }

    const fbError = params.get('fb_error')
    if (fbError) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    apiCheckSession().then(data => {
      if (data) {
        setView('platform')
        if (data.lang) setLang(data.lang)
        localStorage.setItem('fellis_logged_in', 'true')
      } else if (!localStorage.getItem('fellis_logged_in')) {
        setView('landing')
      }
    })
  }, [])

  const handleEnterPlatform = useCallback((selectedLang) => {
    setLang(selectedLang)
    setView('platform')
    localStorage.setItem('fellis_logged_in', 'true')
    localStorage.setItem('fellis_lang', selectedLang)
  }, [])

  const handleLogout = useCallback(() => {
    setView('landing')
    localStorage.removeItem('fellis_logged_in')
    localStorage.removeItem('fellis_lang')
    localStorage.removeItem('fellis_session_id')
    apiLogout().catch(() => {})
  }, [])

  if (view === 'platform') {
    return <Platform lang={lang} onLogout={handleLogout} />
  }

  return <Landing onEnterPlatform={handleEnterPlatform} />
}

export default App
