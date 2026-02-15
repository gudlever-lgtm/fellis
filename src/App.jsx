import { useState, useCallback } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import './App.css'

function App() {
  const [view, setView] = useState(() => {
    return localStorage.getItem('fellis_logged_in') ? 'platform' : 'landing'
  })
  const [lang, setLang] = useState(() => {
    return localStorage.getItem('fellis_lang') || 'da'
  })

  const handleEnterPlatform = useCallback((selectedLang) => {
    setLang(selectedLang)
    setView('platform')
    localStorage.setItem('fellis_logged_in', 'true')
    localStorage.setItem('fellis_lang', selectedLang)
  }, [])

  const handleBackToLanding = useCallback(() => {
    setView('landing')
    localStorage.removeItem('fellis_logged_in')
    localStorage.removeItem('fellis_lang')
  }, [])

  if (view === 'platform') {
    return <Platform lang={lang} onBackToLanding={handleBackToLanding} />
  }

  return <Landing onEnterPlatform={handleEnterPlatform} />
}

export default App
