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

  // On mount, validate session with server if available
  useEffect(() => {
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
