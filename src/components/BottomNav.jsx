import { useState, useEffect } from 'react'
import { apiFetchConversations } from '../api.js'
import { useLanguage } from '../i18n/LanguageContext.jsx'
import { getTranslations } from '../data.js'

const LEFT_TABS  = [
  { id: 'feed',     icon: '🏠' },
  { id: 'explore',  icon: '🔍' },
]
const RIGHT_TABS = [
  { id: 'messages', icon: '💬' },
  { id: 'profile',  icon: '👤' },
]

export default function BottomNav({ page, navigateTo }) {
  const design = localStorage.getItem('fellis_design') || 'classic'
  const { lang } = useLanguage()
  const t = getTranslations(lang)
  const [msgUnread, setMsgUnread] = useState(0)

  useEffect(() => {
    if (design !== 'new') return
    apiFetchConversations().then(data => {
      if (Array.isArray(data)) {
        setMsgUnread(data.reduce((sum, c) => sum + (c.unread || 0), 0))
      }
    }).catch(() => {})
  }, [design])

  if (design !== 'new') return null

  const labels = {
    feed:     t.bottomNav?.feed     || 'Feed',
    explore:  t.bottomNav?.discover || 'Opdag',
    messages: t.bottomNav?.messages || 'Beskeder',
    profile:  t.bottomNav?.me       || 'Mig',
  }

  function Tab({ tab }) {
    return (
      <button
        className={`nav-tab${page === tab.id ? ' active' : ''}`}
        onClick={() => navigateTo(tab.id)}
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <span style={{ fontSize: 22 }}>{tab.icon}</span>
        <span className="nav-label">{labels[tab.id]}</span>
        {tab.id === 'messages' && msgUnread > 0 && (
          <span className="msg-badge">{msgUnread > 99 ? '99+' : msgUnread}</span>
        )}
      </button>
    )
  }

  return (
    <nav className="bottom-nav">
      {LEFT_TABS.map(tab => <Tab key={tab.id} tab={tab} />)}

      {/* Centralt opret-element */}
      <button
        className="nav-tab nav-tab-compose"
        onClick={() => navigateTo('feed')}
        style={{ background: 'none', border: 'none', outline: 'none' }}
      >
        <span className="nav-compose-btn">✏️</span>
        <span className="nav-label">{t.bottomNav?.compose || 'Opret'}</span>
      </button>

      {RIGHT_TABS.map(tab => <Tab key={tab.id} tab={tab} />)}
    </nav>
  )
}
