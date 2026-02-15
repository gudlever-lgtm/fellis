import { useState, useCallback } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import './App.css'

function App() {
  const [view, setView] = useState('landing') // 'landing' | 'platform'
  const [lang, setLang] = useState('da')

  const handleEnterPlatform = useCallback((selectedLang) => {
    setLang(selectedLang)
    setView('platform')
  }, [])

  const handleBackToLanding = useCallback(() => {
    setView('landing')
  }, [])

  if (view === 'platform') {
    return <Platform lang={lang} onBackToLanding={handleBackToLanding} />
  }

  return <Landing onEnterPlatform={handleEnterPlatform} />
}

export default App
