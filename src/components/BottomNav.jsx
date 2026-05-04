import { useState, useEffect } from 'react'
import { apiFetchConversations } from '../api.js'
import { useLanguage } from '../i18n/LanguageContext.jsx'
import { getTranslations } from '../data.js'

const TABS = [
  { id: 'feed',     icon: '🏠' },
  { id: 'explore',  icon: '⭐' },
  { id: 'messages', icon: '💬' },
  { id: 'groups',   icon: '👥' },
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
    groups:   t.bottomNav?.groups   || 'Grupper',
    profile:  t.bottomNav?.me       || 'Mig',
  }

  const isActive = (id) => {
    if (id === 'feed') return page === 'feed'
    if (id === 'explore') return page === 'explore'
    if (id === 'messages') return page === 'messages'
    if (id === 'groups') return page === 'groups' || page === 'group-detail' || page === 'group-settings'
    if (id === 'profile') return page === 'profile' || page === 'edit-profile'
    return false
  }

  return (
    <nav className="bottom-nav">
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`bottom-nav-tab${isActive(tab.id) ? ' active' : ''}`}
          onClick={() => navigateTo(tab.id === 'explore' ? 'explore' : tab.id)}
        >
          <span className="bottom-nav-icon">{tab.icon}</span>
          <span className="bottom-nav-label">{labels[tab.id]}</span>
          {tab.id === 'messages' && msgUnread > 0 && (
            <span className="bottom-nav-badge">{msgUnread > 99 ? '99+' : msgUnread}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
