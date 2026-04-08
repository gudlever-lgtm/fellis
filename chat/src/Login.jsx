import { useState } from 'react'
import { apiLogin } from './api.js'
import { t } from './data.js'

export default function Login({ lang, onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const s = {
    page: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f4f5f7',
      fontFamily: 'system-ui, sans-serif',
    },
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: '40px 36px',
      width: '100%',
      maxWidth: 380,
      boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
    },
    logo: {
      fontSize: 26,
      fontWeight: 700,
      color: '#1877f2',
      marginBottom: 28,
      textAlign: 'center',
    },
    label: {
      display: 'block',
      fontSize: 13,
      fontWeight: 600,
      color: '#444',
      marginBottom: 6,
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1.5px solid #ddd',
      borderRadius: 8,
      fontSize: 15,
      outline: 'none',
      boxSizing: 'border-box',
      marginBottom: 16,
      transition: 'border-color 0.15s',
    },
    button: {
      width: '100%',
      padding: '11px 0',
      background: loading ? '#aac8f7' : '#1877f2',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      fontSize: 15,
      fontWeight: 700,
      cursor: loading ? 'default' : 'pointer',
      marginTop: 4,
    },
    error: {
      color: '#d32f2f',
      fontSize: 13,
      marginTop: 10,
      textAlign: 'center',
    },
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await apiLogin(email, password, lang)
    setLoading(false)
    if (!res) {
      setError(t(lang, 'loginFailed'))
      return
    }
    if (res.error || res.status >= 400) {
      setError(res.status === 401 ? t(lang, 'loginError') : t(lang, 'loginFailed'))
      return
    }
    if (res.sessionId) {
      localStorage.setItem('fellis_session_id', res.sessionId)
    }
    onLogin(res)
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>{t(lang, 'appName')}</div>
        <form onSubmit={handleSubmit} autoComplete="on">
          <label style={s.label}>{t(lang, 'email')}</label>
          <input
            style={s.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <label style={s.label}>{t(lang, 'password')}</label>
          <input
            style={s.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button style={s.button} type="submit" disabled={loading}>
            {loading ? t(lang, 'loggingIn') : t(lang, 'loginButton')}
          </button>
          {error && <div style={s.error}>{error}</div>}
        </form>
      </div>
    </div>
  )
}
