import { useState, useEffect, useRef, useCallback } from 'react'
import { nameToColor, getInitials } from './data.js'
import { apiFetchReels, apiUploadReel, apiToggleReelLike, apiFetchReelComments, apiAddReelComment, apiDeleteReel } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Single Reel Card ──────────────────────────────────────────────────────────
function ReelCard({ reel, t, currentUser, onDelete }) {
  const [liked, setLiked] = useState(reel.liked_by_me)
  const [likesCount, setLikesCount] = useState(Number(reel.likes_count))
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [muted, setMuted] = useState(true)
  const videoRef = useRef(null)

  const isOwn = currentUser?.id && reel.user_id === currentUser.id

  // Intersection Observer: autoplay when visible
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {})
        } else {
          el.pause()
        }
      },
      { threshold: 0.6 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const toggleLike = async () => {
    const prev = liked
    setLiked(!prev)
    setLikesCount(c => prev ? c - 1 : c + 1)
    const data = await apiToggleReelLike(reel.id)
    if (data) {
      setLiked(data.liked)
      setLikesCount(data.likes_count)
    } else {
      setLiked(prev)
      setLikesCount(c => prev ? c + 1 : c - 1)
    }
  }

  const openComments = async () => {
    setShowComments(v => !v)
    if (comments === null) {
      const data = await apiFetchReelComments(reel.id)
      setComments(data?.comments || [])
    }
  }

  const submitComment = async (e) => {
    e.preventDefault()
    const text = commentText.trim()
    if (!text || submitting) return
    setSubmitting(true)
    const data = await apiAddReelComment(reel.id, text)
    if (data?.comment) {
      setComments(prev => [...(prev || []), data.comment])
      setCommentText('')
    }
    setSubmitting(false)
  }

  const handleDelete = async () => {
    if (!window.confirm(t.reelsDeleteConfirm)) return
    const data = await apiDeleteReel(reel.id)
    if (data?.ok) onDelete(reel.id)
  }

  const avatarUrl = reel.author_avatar ? `${API_BASE}/uploads/${reel.author_avatar}` : null

  const s = {
    card: {
      position: 'relative',
      width: '100%',
      maxWidth: 420,
      margin: '0 auto 32px',
      background: '#000',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
    },
    videoWrap: {
      position: 'relative',
      width: '100%',
      aspectRatio: '9/16',
      background: '#111',
    },
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      cursor: 'pointer',
    },
    muteBtn: {
      position: 'absolute',
      top: 12,
      right: 12,
      background: 'rgba(0,0,0,0.5)',
      border: 'none',
      borderRadius: '50%',
      width: 36,
      height: 36,
      fontSize: 16,
      cursor: 'pointer',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      position: 'absolute',
      top: 12,
      left: 12,
      background: 'rgba(0,0,0,0.5)',
      border: 'none',
      borderRadius: '50%',
      width: 36,
      height: 36,
      fontSize: 14,
      cursor: 'pointer',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    overlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '48px 16px 16px',
      background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
      color: '#fff',
    },
    author: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: '50%',
      objectFit: 'cover',
      border: '2px solid #fff',
    },
    avatarFallback: {
      width: 36,
      height: 36,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 13,
      fontWeight: 700,
      color: '#fff',
      border: '2px solid #fff',
      flexShrink: 0,
    },
    authorName: { fontWeight: 700, fontSize: 14 },
    caption: { fontSize: 13, lineHeight: 1.4, marginTop: 4, wordBreak: 'break-word' },
    actions: {
      display: 'flex',
      gap: 20,
      padding: '12px 16px',
      background: '#111',
      alignItems: 'center',
    },
    actionBtn: {
      background: 'none',
      border: 'none',
      color: '#fff',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 14,
      padding: 0,
    },
    commentsSection: {
      background: '#1a1a1a',
      borderTop: '1px solid #333',
      maxHeight: 280,
      display: 'flex',
      flexDirection: 'column',
    },
    commentsList: {
      flex: 1,
      overflowY: 'auto',
      padding: '8px 16px',
    },
    commentItem: {
      padding: '6px 0',
      borderBottom: '1px solid #2a2a2a',
      color: '#eee',
      fontSize: 13,
    },
    commentAuthor: { fontWeight: 600, color: '#ccc', marginRight: 6 },
    commentForm: {
      display: 'flex',
      gap: 8,
      padding: '8px 16px 12px',
      borderTop: '1px solid #2a2a2a',
    },
    commentInput: {
      flex: 1,
      background: '#2a2a2a',
      border: 'none',
      borderRadius: 20,
      padding: '8px 14px',
      color: '#fff',
      fontSize: 13,
      outline: 'none',
    },
    commentSubmit: {
      background: '#1877F2',
      border: 'none',
      borderRadius: 20,
      padding: '8px 14px',
      color: '#fff',
      fontSize: 13,
      cursor: 'pointer',
      fontWeight: 600,
    },
  }

  return (
    <div style={s.card}>
      <div style={s.videoWrap}>
        <video
          ref={videoRef}
          src={`${API_BASE}${reel.video_url}`}
          style={s.video}
          loop
          muted={muted}
          playsInline
          onClick={() => setMuted(v => !v)}
        />
        <button style={s.muteBtn} onClick={() => setMuted(v => !v)} title={muted ? 'Slå lyd til' : 'Slå lyd fra'}>
          {muted ? '🔇' : '🔊'}
        </button>
        {isOwn && (
          <button style={s.deleteBtn} onClick={handleDelete} title={t.reelsDelete}>
            🗑️
          </button>
        )}
        <div style={s.overlay}>
          <div style={s.author}>
            {avatarUrl
              ? <img src={avatarUrl} style={s.avatar} alt="" />
              : <div style={{ ...s.avatarFallback, background: nameToColor(reel.author_name) }}>{getInitials(reel.author_name)}</div>
            }
            <div>
              <div style={s.authorName}>{reel.author_name}</div>
              <div style={{ fontSize: 11, color: '#ccc' }}>{reel.author_handle}</div>
            </div>
          </div>
          {reel.caption && <div style={s.caption}>{reel.caption}</div>}
        </div>
      </div>

      <div style={s.actions}>
        <button style={s.actionBtn} onClick={toggleLike}>
          <span style={{ fontSize: 20 }}>{liked ? '❤️' : '🤍'}</span>
          <span>{likesCount} {t.reelsLikes}</span>
        </button>
        <button style={s.actionBtn} onClick={openComments}>
          <span style={{ fontSize: 20 }}>💬</span>
          <span>{Number(reel.comments_count)} {t.reelsComments}</span>
        </button>
      </div>

      {showComments && (
        <div style={s.commentsSection}>
          <div style={s.commentsList}>
            {comments === null ? (
              <div style={{ color: '#888', padding: '8px 0', fontSize: 13 }}>...</div>
            ) : comments.length === 0 ? (
              <div style={{ color: '#888', padding: '8px 0', fontSize: 13 }}>—</div>
            ) : comments.map(c => (
              <div key={c.id} style={s.commentItem}>
                <span style={s.commentAuthor}>{c.author_name}</span>
                {c.text}
              </div>
            ))}
          </div>
          <form style={s.commentForm} onSubmit={submitComment}>
            <input
              style={s.commentInput}
              placeholder={t.reelsComment}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              maxLength={2000}
            />
            <button style={s.commentSubmit} type="submit" disabled={submitting || !commentText.trim()}>
              {t.send}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ t, onClose, onUploaded }) {
  const [videoFile, setVideoFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 200 * 1024 * 1024) {
      setError('Filen er for stor (maks. 200 MB)')
      return
    }
    setVideoFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!videoFile) return
    setUploading(true)
    setError('')
    try {
      const data = await apiUploadReel(videoFile, caption.trim() || '')
      if (data?.reel) {
        onUploaded(data.reel)
        onClose()
      } else {
        setError('Upload fejlede. Prøv igen.')
      }
    } catch (err) {
      setError(err.message || 'Upload fejlede')
    }
    setUploading(false)
  }

  const s = {
    overlay: {
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
      background: '#1a1a1a',
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 440,
      color: '#fff',
      boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    },
    title: { fontSize: 18, fontWeight: 700, marginBottom: 16 },
    uploadZone: {
      border: '2px dashed #444',
      borderRadius: 12,
      padding: '32px 16px',
      textAlign: 'center',
      cursor: 'pointer',
      marginBottom: 16,
      color: '#aaa',
      fontSize: 14,
    },
    preview: {
      width: '100%',
      borderRadius: 8,
      marginBottom: 16,
      maxHeight: 240,
      objectFit: 'contain',
      background: '#000',
    },
    input: {
      width: '100%',
      background: '#2a2a2a',
      border: '1px solid #444',
      borderRadius: 8,
      padding: '10px 12px',
      color: '#fff',
      fontSize: 14,
      marginBottom: 16,
      boxSizing: 'border-box',
      outline: 'none',
    },
    actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
    cancelBtn: {
      background: '#2a2a2a', border: 'none', borderRadius: 8,
      padding: '10px 18px', color: '#ccc', cursor: 'pointer', fontSize: 14,
    },
    submitBtn: {
      background: '#1877F2', border: 'none', borderRadius: 8,
      padding: '10px 18px', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
    },
    error: { color: '#ff6b6b', fontSize: 13, marginBottom: 12 },
    hint: { color: '#888', fontSize: 12, marginTop: 4 },
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.title}>{t.reelsUploadTitle}</div>

        {previewUrl ? (
          <video src={previewUrl} style={s.preview} controls muted />
        ) : (
          <div style={s.uploadZone} onClick={() => fileInputRef.current?.click()}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
            <div>{t.reelsSelectVideo}</div>
            <div style={s.hint}>{t.reelsVideoHint}</div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />

        {videoFile && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
            {videoFile.name}
            <button
              onClick={() => { setVideoFile(null); setPreviewUrl(null) }}
              style={{ marginLeft: 8, background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12 }}
            >✕</button>
          </div>
        )}

        <textarea
          style={{ ...s.input, resize: 'vertical', minHeight: 72 }}
          placeholder={t.reelsCaption}
          value={caption}
          onChange={e => setCaption(e.target.value)}
          maxLength={2000}
          rows={3}
        />

        {error && <div style={s.error}>{error}</div>}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>{t.cancel}</button>
          <button
            style={{ ...s.submitBtn, opacity: (!videoFile || uploading) ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={!videoFile || uploading}
          >
            {uploading ? t.reelsUploading : t.reelsUploadBtn}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ReelsPage ────────────────────────────────────────────────────────────
export default function ReelsPage({ t, currentUser }) {
  const [reels, setReels] = useState([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const LIMIT = 10

  const loadReels = useCallback(async (off = 0) => {
    setLoading(true)
    const data = await apiFetchReels(off, LIMIT)
    if (data?.reels) {
      setReels(prev => off === 0 ? data.reels : [...prev, ...data.reels])
      setHasMore(data.reels.length === LIMIT)
      setOffset(off + data.reels.length)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadReels(0) }, [loadReels])

  const handleUploaded = (reel) => {
    setReels(prev => [reel, ...prev])
  }

  const handleDelete = (id) => {
    setReels(prev => prev.filter(r => r.id !== id))
  }

  const s = {
    page: {
      maxWidth: 480,
      margin: '0 auto',
      padding: '24px 16px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 22,
      fontWeight: 700,
    },
    uploadBtn: {
      background: '#1877F2',
      border: 'none',
      borderRadius: 20,
      padding: '10px 18px',
      color: '#fff',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    empty: {
      textAlign: 'center',
      color: '#888',
      padding: '60px 0',
      fontSize: 15,
    },
    loadMore: {
      display: 'block',
      margin: '0 auto 32px',
      background: '#2a2a2a',
      border: 'none',
      borderRadius: 20,
      padding: '10px 24px',
      color: '#ccc',
      cursor: 'pointer',
      fontSize: 14,
    },
    loader: {
      textAlign: 'center',
      color: '#888',
      padding: 24,
    },
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.title}>{t.reelsTitle}</div>
        <button style={s.uploadBtn} onClick={() => setShowUpload(true)}>
          🎬 {t.reelsUpload}
        </button>
      </div>

      {!loading && reels.length === 0 && (
        <div style={s.empty}>{t.reelsNoReels}</div>
      )}

      {reels.map(reel => (
        <ReelCard
          key={reel.id}
          reel={reel}
          t={t}
          currentUser={currentUser}
          onDelete={handleDelete}
        />
      ))}

      {loading && <div style={s.loader}>⏳</div>}

      {!loading && hasMore && reels.length > 0 && (
        <button style={s.loadMore} onClick={() => loadReels(offset)}>
          {t.reelsLoadMore}
        </button>
      )}

      {showUpload && (
        <UploadModal
          t={t}
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  )
}
