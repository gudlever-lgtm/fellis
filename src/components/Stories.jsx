import { useState, useEffect } from 'react'
import { apiGetFollowing } from '../api.js'
import { useLanguage } from '../i18n/LanguageContext.jsx'
import { getTranslations, getInitials, nameToColor } from '../data.js'

const SEEN_KEY = 'fellis_stories_seen'

function getSeenSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() }
}

function markSeen(id) {
  const s = getSeenSet()
  s.add(id)
  localStorage.setItem(SEEN_KEY, JSON.stringify([...s]))
}

export default function Stories({ currentUser }) {
  const design = localStorage.getItem('fellis_design') || 'classic'
  const { lang } = useLanguage()
  const t = getTranslations(lang)
  const [following, setFollowing] = useState([])
  const [seen, setSeen] = useState(getSeenSet)

  useEffect(() => {
    if (design !== 'new') return
    apiGetFollowing().then(data => {
      if (data?.users) setFollowing(data.users.slice(0, 12))
    }).catch(() => {})
  }, [design])

  if (design !== 'new') return null

  function handleStoryClick(userId) {
    markSeen(userId)
    setSeen(getSeenSet())
  }

  return (
    <div className="design-new stories-strip">
      {/* Your story */}
      <div className="story-item" onClick={() => {}}>
        <div className="story-ring">
          <div className="story-inner" style={{ background: nameToColor(currentUser?.name || 'U') }}>
            +
          </div>
        </div>
        <span className="story-label">{t.stories?.yourStory || 'Din story'}</span>
      </div>

      {following.map(user => (
        <div key={user.id} className="story-item" onClick={() => handleStoryClick(user.id)}>
          <div className={`story-ring${seen.has(user.id) ? ' seen' : ''}`}>
            <div
              className="story-inner"
              style={{ background: nameToColor(user.name || '') }}
            >
              {getInitials(user.name || '?')}
            </div>
          </div>
          <span className="story-label">{(user.name || '').split(' ')[0]}</span>
        </div>
      ))}
    </div>
  )
}
