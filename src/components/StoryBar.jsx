import { useState, useEffect, useRef } from 'react'
import { nameToColor, getInitials, getTranslations } from '../data.js'

const STORY_COLORS = ['#2D6A4F', '#1877F2', '#E07A5F', '#6C63FF', '#D4A574', '#3D405B', '#40916C', '#F2CC8F']

export default function StoryBar({ currentUser, lang, onStoriesChange }) {
  const [stories, setStories] = useState([])
  const [viewingStory, setViewingStory] = useState(null)
  const [creating, setCreating] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftColor, setDraftColor] = useState('#2D6A4F')
  const [posting, setPosting] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    fetch('/api/stories/feed', { headers: { 'X-Session-Id': localStorage.getItem('fellis_session_id') } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setStories(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Auto-close viewer after 5 seconds
  useEffect(() => {
    if (viewingStory) {
      timerRef.current = setTimeout(() => setViewingStory(null), 5000)
    }
    return () => clearTimeout(timerRef.current)
  }, [viewingStory])

  const ownStory = stories.find(s => s.user_id === currentUser?.id)
  const otherStories = stories.filter(s => s.user_id !== currentUser?.id)

  const handlePostStory = async () => {
    if (!draftText.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': localStorage.getItem('fellis_session_id'),
        },
        body: JSON.stringify({ content_text: draftText.trim(), bg_color: draftColor }),
      })
      if (res.ok) {
        const story = await res.json()
        setStories(prev => [story, ...prev.filter(s => s.user_id !== currentUser?.id)])
        if (onStoriesChange) onStoriesChange()
      }
    } catch { /* network unavailable */ }
    setPosting(false)
    setCreating(false)
    setDraftText('')
    setDraftColor('#2D6A4F')
  }

  const handleDeleteStory = async (id) => {
    try {
      await fetch(`/api/stories/${id}`, {
        method: 'DELETE',
        headers: { 'X-Session-Id': localStorage.getItem('fellis_session_id') },
      })
      setStories(prev => prev.filter(s => s.id !== id))
    } catch { /* network unavailable */ }
  }

  const tr = getTranslations(lang)
  const t = {
    myStory: tr.storyMyStory,
    addStory: tr.storyAdd,
    createTitle: tr.storyCreateTitle,
    placeholder: tr.storyPlaceholder,
    post: tr.share,
    cancel: tr.cancel,
    deleteStory: tr.storyDelete,
  }

  return (
    <>
      <div className="story-bar">
        {/* Own avatar — opens create modal (or view own story if exists) */}
        <div className="story-item" onClick={() => ownStory ? setViewingStory(ownStory) : setCreating(true)}>
          <div className="story-avatar-wrap">
            <div className={`story-avatar-ring ${ownStory ? 'has-story own' : 'own'}`}>
              <div
                className="story-avatar-inner"
                style={{ background: nameToColor(currentUser?.name || '') }}
              >
                {currentUser?.avatar_url
                  ? <img src={currentUser.avatar_url} alt="" />
                  : (currentUser?.initials || getInitials(currentUser?.name || ''))}
              </div>
            </div>
            {!ownStory && <div className="story-add-icon">+</div>}
          </div>
          <span className="story-name">{ownStory ? t.myStory : t.addStory}</span>
        </div>

        {/* Friends' stories */}
        {otherStories.map(story => (
          <div key={story.id} className="story-item" onClick={() => setViewingStory(story)}>
            <div className="story-avatar-wrap">
              <div className="story-avatar-ring has-story">
                <div
                  className="story-avatar-inner"
                  style={{ background: nameToColor(story.name || '') }}
                >
                  {story.avatar_url
                    ? <img src={story.avatar_url} alt="" />
                    : (story.initials || getInitials(story.name || ''))}
                </div>
              </div>
            </div>
            <span className="story-name">{story.name?.split(' ')[0]}</span>
          </div>
        ))}
      </div>

      {/* Story viewer */}
      {viewingStory && (
        <div className="story-overlay">
          <div className="story-overlay-bg" onClick={() => setViewingStory(null)} />
          <div className="story-card" style={{ background: viewingStory.bg_color }}>
            <div className="story-card-progress">
              <div className="story-card-progress-bar" key={viewingStory.id} />
            </div>
            <div className="story-card-author">
              <div className="story-avatar-ring" style={{ width: 40, height: 40 }}>
                <div className="story-avatar-inner" style={{ background: nameToColor(viewingStory.name || '') }}>
                  {viewingStory.avatar_url
                    ? <img src={viewingStory.avatar_url} alt="" />
                    : getInitials(viewingStory.name || '')}
                </div>
              </div>
              <span className="story-card-author-name">{viewingStory.name}</span>
            </div>
            <p className="story-card-text" style={{ marginTop: 64 }}>{viewingStory.content_text}</p>
            {viewingStory.user_id === currentUser?.id && (
              <button
                onClick={() => { handleDeleteStory(viewingStory.id); setViewingStory(null) }}
                style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 20, padding: '6px 16px', color: '#fff', fontSize: 13, cursor: 'pointer', marginTop: 8 }}
              >
                🗑 {t.deleteStory}
              </button>
            )}
            <button className="story-card-close" onClick={() => setViewingStory(null)}>✕</button>
          </div>
        </div>
      )}

      {/* Create story modal */}
      {creating && (
        <div className="story-create-modal">
          <div className="story-create-modal-bg" onClick={() => setCreating(false)} />
          <div className="story-create-card">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.createTitle}</h3>
            <div className="story-create-preview" style={{ background: draftColor }}>
              {draftText || <span style={{ opacity: 0.6 }}>{t.placeholder}</span>}
            </div>
            <textarea
              autoFocus
              maxLength={280}
              placeholder={t.placeholder}
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #E8E4DF', fontSize: 15, resize: 'none', fontFamily: 'inherit', minHeight: 70 }}
            />
            <div className="story-color-row">
              {STORY_COLORS.map(c => (
                <button
                  key={c}
                  className={`story-color-btn${draftColor === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setDraftColor(c)}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setCreating(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 20, border: '1px solid #E8E4DF', background: '#fff', fontSize: 14, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
              <button
                onClick={handlePostStory}
                disabled={!draftText.trim() || posting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 20, border: 'none', background: '#2D6A4F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (!draftText.trim() || posting) ? 0.5 : 1 }}
              >
                {posting ? '...' : t.post}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
