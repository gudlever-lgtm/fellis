import { useState, useEffect } from 'react'
import { apiGetHashtagFollows, apiFollowHashtag, apiUnfollowHashtag } from '../api.js'

export default function HashtagFollows({ lang }) {
  const [followed, setFollowed] = useState(null)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? { title: 'Fulgte emner', add: 'Følg', remove: 'Stop', inputPh: 'f.eks. teknologi', empty: 'Du følger ingen emner endnu.', note: 'Opslag med disse emner vises i dit feed.' }
    : { title: 'Followed topics', add: 'Follow', remove: 'Unfollow', inputPh: 'e.g. technology', empty: 'You don\'t follow any topics yet.', note: 'Posts with these topics will appear in your feed.' }

  useEffect(() => {
    apiGetHashtagFollows().then(d => setFollowed(d?.hashtags || []))
  }, [])

  const handleAdd = async () => {
    const tag = input.trim().replace(/^#/, '')
    if (!tag || followed.includes(tag)) return
    setSaving(true)
    await apiFollowHashtag(tag)
    setFollowed(prev => [...prev, tag].sort())
    setInput('')
    setSaving(false)
  }

  const handleRemove = async (tag) => {
    await apiUnfollowHashtag(tag)
    setFollowed(prev => prev.filter(t => t !== tag))
  }

  if (!followed) return <div style={{ color: '#888', padding: 16 }}>…</div>

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>🏷️ {t.title}</h3>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>{t.note}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={`# ${t.inputPh}`}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14 }}
        />
        <button onClick={handleAdd} disabled={saving || !input.trim()}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          {t.add}
        </button>
      </div>
      {followed.length === 0 && <div style={{ fontSize: 14, color: '#888' }}>{t.empty}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {followed.map(tag => (
          <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg,#f0f4f8)', borderRadius: 20, padding: '5px 12px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1877F2' }}>#{tag}</span>
            <button onClick={() => handleRemove(tag)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
