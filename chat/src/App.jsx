import { useState, useEffect } from 'react'
import Login from './Login.jsx'
import Chat from './Chat.jsx'
import { apiCheckSession, apiLogout } from './api.js'
import { getLang, setLang, t } from './data.js'

export default function App() {
  const [lang, setLangState] = useState(getLang())
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function check() {
      const res = await apiCheckSession()
      if (res && !res.error && res.user) {
        setUser(res.user)
      }
      setChecking(false)
    }
    check()
  }, [])

  function handleLogin(res) {
    setUser(res.user || { name: res.name })
  }

  async function handleLogout() {
    await apiLogout()
    localStorage.removeItem('fellis_session_id')
    setUser(null)
  }

  function toggleLang() {
    const next = lang === 'da' ? 'en' : 'da'
    setLang(next)
    setLangState(next)
  }

  const s = {
    langToggle: {
      position: 'fixed',
      top: 10,
      right: 14,
      zIndex: 1000,
      background: 'rgba(255,255,255,0.92)',
      border: '1px solid #ddd',
      borderRadius: 6,
      padding: '4px 10px',
      fontSize: 12,
      cursor: 'pointer',
      color: '#555',
    },
    loading: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontSize: 16,
      color: '#aaa',
      fontFamily: 'system-ui, sans-serif',
    },
  }

  if (checking) {
    return <div style={s.loading}>fellis chat</div>
  }

  return (
    <>
      {!user && (
        <button style={s.langToggle} onClick={toggleLang}>
          {lang === 'da' ? t(lang, 'langEn') : t(lang, 'langDa')}
        </button>
      )}
      {user ? (
        <Chat lang={lang} user={user} onLogout={handleLogout} />
      ) : (
        <Login lang={lang} onLogin={handleLogin} />
      )}
    </>
  )
}
