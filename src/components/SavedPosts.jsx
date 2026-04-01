import { useState, useEffect } from 'react'
import { apiGetSavedPosts, apiUnsavePost } from '../api.js'
import { nameToColor, getInitials } from '../data.js'

export default function SavedPosts({ lang, onViewPost }) {
  const [posts, setPosts] = useState(null)
  const t = lang === 'da'
    ? { title: 'Gemte opslag', empty: 'Du har ikke gemt nogen opslag endnu.', unsave: 'Fjern', loading: 'Henter…' }
    : { title: 'Saved posts', empty: 'You haven\'t saved any posts yet.', unsave: 'Remove', loading: 'Loading…' }

  useEffect(() => {
    apiGetSavedPosts().then(d => setPosts(d?.posts || []))
  }, [])

  const handleUnsave = async (postId) => {
    await apiUnsavePost(postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
  }

  if (!posts) return <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{t.loading}</div>

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>🔖 {t.title}</h2>
      {posts.length === 0
        ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{t.empty}</div>
        : posts.map(post => (
          <div key={post.id} className="p-card" style={{ marginBottom: 10, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: nameToColor(post.author_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {post.author_avatar
                  ? <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  : getInitials(post.author_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{post.author_name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>@{post.author_handle}</div>
              </div>
              <button
                onClick={() => handleUnsave(post.id)}
                style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #ddd', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#888' }}
              >
                {t.unsave}
              </button>
            </div>
            <div
              style={{ fontSize: 14, lineHeight: 1.5, cursor: 'pointer' }}
              onClick={() => onViewPost?.(post.id)}
            >
              {post.text?.slice(0, 200)}{post.text?.length > 200 ? '…' : ''}
            </div>
          </div>
        ))
      }
    </div>
  )
}
