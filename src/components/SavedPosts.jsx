import { useState, useEffect } from 'react'
import { apiGetSavedPosts, apiUnsavePost } from '../api.js'
import { nameToColor, getInitials, getTranslations } from '../data.js'
import { getLocale } from '../utils/dateFormat.js'

export default function SavedPosts({ lang, onViewPost }) {
  const [posts, setPosts] = useState(null)
  const t = getTranslations(lang)

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
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>🔖 {t.savedPosts}</h2>
      {posts.length === 0
        ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{t.savedPostsEmpty}</div>
        : posts.map(post => {
          const text = post[`text_${lang}`] || post.text_da || post.text_en || ''
          const savedAt = post.saved_at ? new Date(post.saved_at).toLocaleDateString(getLocale(lang), { day: 'numeric', month: 'short', year: 'numeric' }) : null
          return (
            <div key={post.id} className="p-card" style={{ marginBottom: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: nameToColor(post.author_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {post.author_avatar
                    ? <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                    : getInitials(post.author_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{post.author_name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>@{post.author_handle}{savedAt ? ` · ${t.savedOn} ${savedAt}` : ''}</div>
                </div>
                <button
                  onClick={() => handleUnsave(post.id)}
                  style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #ddd', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#888' }}
                >
                  {t.unsavePost}
                </button>
              </div>
              {text ? (
                <div
                  style={{ fontSize: 14, lineHeight: 1.5, cursor: 'pointer', marginBottom: 8 }}
                  onClick={() => onViewPost?.(post.id)}
                >
                  {text.slice(0, 200)}{text.length > 200 ? '…' : ''}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#aaa' }}>
                {post.like_count > 0 && <span>👍 {post.like_count}</span>}
                {post.comment_count > 0 && <span>💬 {post.comment_count}</span>}
              </div>
            </div>
          )
        })
      }
    </div>
  )
}
