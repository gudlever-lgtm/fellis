import { useState, useEffect, useRef, useCallback } from 'react'
import { nameToColor, getInitials, REACTIONS } from './data.js'
import { apiFetchReels, apiUploadReel, apiToggleReelLike, apiFetchReelComments, apiAddReelComment, apiDeleteReel, apiSearchUsers } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Single Reel Card ──────────────────────────────────────────────────────────
function ReelCard({ reel, t, currentUser, onDelete, onViewProfile }) {
  const [liked, setLiked] = useState(reel.liked_by_me)
  const [myReaction, setMyReaction] = useState(reel.my_reaction || '❤️')
  const [likesCount, setLikesCount] = useState(Number(reel.likes_count))
  const [showComments, setShowComments] = useState(false)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [comments, setComments] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [looping, setLooping] = useState(true)
  const [progress, setProgress] = useState(0)      // 0–1
  const [duration, setDuration] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const videoRef = useRef(null)
  const progressRef = useRef(null)

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

  // Track video progress for the timeline bar and play/pause state
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTime = () => { if (!seeking && el.duration) setProgress(el.currentTime / el.duration) }
    const onMeta = () => setDuration(el.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [seeking])

  // Seek on progress bar click/drag
  const handleSeek = useCallback((e) => {
    const bar = progressRef.current
    const el = videoRef.current
    if (!bar || !el || !el.duration) return
    const rect = bar.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * el.duration
    setProgress(ratio)
  }, [])

  useEffect(() => {
    const bar = progressRef.current
    if (!bar) return
    const onMove = (e) => { if (seeking) handleSeek(e) }
    const onUp = () => setSeeking(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [seeking, handleSeek])

  const pickReaction = async (emoji) => {
    setShowReactionPicker(false)
    const prevLiked = liked
    const prevReaction = myReaction
    const isUnlike = liked && emoji === myReaction
    setLiked(!isUnlike)
    if (!isUnlike) setMyReaction(emoji)
    setLikesCount(c => isUnlike ? c - 1 : (prevLiked ? c : c + 1))
    const data = await apiToggleReelLike(reel.id, emoji)
    if (data) {
      setLiked(data.liked)
      setLikesCount(data.likes_count)
      if (data.reaction) setMyReaction(data.reaction)
    } else {
      setLiked(prevLiked); setMyReaction(prevReaction)
      setLikesCount(c => isUnlike ? c + 1 : (prevLiked ? c : c - 1))
    }
  }

  const toggleLike = () => {
    if (liked) {
      pickReaction(myReaction) // unlike
    } else {
      setShowReactionPicker(true) // show picker like posts do
    }
  }

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) { el.play().catch(() => {}) } else { el.pause() }
  }, [])

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

  const avatarUrl = reel.author_avatar
    ? (reel.author_avatar.startsWith('http') ? reel.author_avatar : `${API_BASE}${reel.author_avatar}`)
    : null

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

  const fmtDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const fmtDuration = (sec) => {
    if (!sec) return ''
    const m = Math.floor(sec / 60)
    const s2 = Math.floor(sec % 60)
    return `${m}:${String(s2).padStart(2, '0')}`
  }

  return (
    <div style={{ display: 'flex', gap: 20, maxWidth: 800, margin: '0 auto 32px', alignItems: 'flex-start' }}>
      {/* ── Reel video card ── */}
      <div style={{ ...s.card, margin: 0, flex: '0 0 auto', width: 460 }}>
      <div style={s.videoWrap}>
        <video
          ref={videoRef}
          src={`${API_BASE}${reel.video_url}`}
          style={s.video}
          loop={looping}
          muted={muted}
          playsInline
          onClick={() => { togglePlay(); setShowReactionPicker(false) }}
        />
        {!playing && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.45)', borderRadius: '50%',
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, pointerEvents: 'none',
          }}>▶</div>
        )}
        <button style={s.muteBtn} onClick={() => setMuted(v => !v)} title={muted ? 'Slå lyd til' : 'Slå lyd fra'}>
          {muted ? '🔇' : '🔊'}
        </button>
        {/* Loop / play-once toggle */}
        <button
          onClick={() => setLooping(v => !v)}
          title={looping ? 'Afspil én gang' : 'Loop'}
          style={{
            position: 'absolute', top: 44, right: 8, zIndex: 4,
            background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 20,
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            padding: '3px 9px', lineHeight: 1.4,
          }}
        >
          {looping ? '🔁' : '1️⃣'}
        </button>
        {isOwn && (
          <button style={s.deleteBtn} onClick={handleDelete} title={t.reelsDelete}>
            🗑️
          </button>
        )}
        {/* Avatar icon at bottom-left of video */}
        <div style={{ position: 'absolute', bottom: 28, left: 12, zIndex: 2 }}>
          <div
            onClick={() => onViewProfile && onViewProfile(reel.user_id)}
            style={{ cursor: onViewProfile ? 'pointer' : 'default' }}
            title={reel.author_name}
          >
            {avatarUrl
              ? <img src={avatarUrl} style={{ ...s.avatar, width: 40, height: 40 }} alt="" />
              : <div style={{ ...s.avatarFallback, width: 40, height: 40, background: nameToColor(reel.author_name) }}>{getInitials(reel.author_name)}</div>
            }
          </div>
        </div>

        {/* ── Timeline progress bar ── */}
        <div
          ref={progressRef}
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 20, cursor: 'pointer', display: 'flex', alignItems: 'flex-end',
          }}
          onMouseDown={e => { setSeeking(true); handleSeek(e) }}
          onTouchStart={e => { setSeeking(true); handleSeek(e) }}
        >
          <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.3)', position: 'relative' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: '#fff', borderRadius: 2 }} />
            <div style={{
              position: 'absolute', top: '50%', left: `${progress * 100}%`,
              transform: 'translate(-50%,-50%)',
              width: 10, height: 10, borderRadius: '50%', background: '#fff',
              boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            }} />
          </div>
        </div>
      </div>

      <div style={{ ...s.actions, position: 'relative' }}>
        {/* Reaction picker popup */}
        {showReactionPicker && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setShowReactionPicker(false)} />
            <div style={{
              position: 'absolute', bottom: '100%', left: 0,
              background: '#1a1a1a', borderRadius: 30, padding: '8px 12px',
              display: 'flex', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              zIndex: 10,
            }}>
              {REACTIONS.map(r => (
                <button key={r.emoji} title={r.label.da}
                  style={{ background: 'none', border: 'none', fontSize: 28, cursor: 'pointer', padding: '2px 4px', borderRadius: 6, transition: 'transform 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.3)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
                  onClick={() => pickReaction(r.emoji)}
                >{r.emoji}</button>
              ))}
            </div>
          </>
        )}
        <button style={s.actionBtn} onClick={togglePlay}>
          <span style={{ fontSize: 20 }}>{playing ? '⏸' : '▶'}</span>
        </button>
        <button style={s.actionBtn} onClick={toggleLike}>
          <span style={{ fontSize: 20 }}>{liked ? myReaction : '🤍'}</span>
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
      </div>{/* end video card */}

      {/* ── Info card ── */}
      <div style={{ flex: 1, background: '#fff', borderRadius: 16, padding: '20px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Author */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: onViewProfile ? 'pointer' : 'default' }}
          onClick={() => onViewProfile && onViewProfile(reel.user_id)}
        >
          {avatarUrl
            ? <img src={avatarUrl} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} alt="" />
            : <div style={{ width: 44, height: 44, borderRadius: '50%', background: nameToColor(reel.author_name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{getInitials(reel.author_name)}</div>
          }
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{reel.author_name}</div>
            <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>{reel.author_handle}</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #f0f0f0' }} />

        {/* Caption */}
        {reel.caption && (
          <div style={{ fontSize: 14, color: '#333', lineHeight: 1.55, wordBreak: 'break-word' }}>
            {reel.caption}
          </div>
        )}

        {/* Tagged users */}
        {reel.tagged_users?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888' }}>Med:</span>
            {reel.tagged_users.map(u => (
              <span key={u.id} style={{ fontSize: 12, color: '#2D6A4F', fontWeight: 600, background: '#F0FAF4', borderRadius: 20, padding: '2px 8px' }}>👤 {u.name}</span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: '#555' }}>
          {reel.created_at && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>📅</span>
              <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(reel.created_at)}</span>
            </div>
          )}
          {duration > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>⏱</span>
              <span style={{ whiteSpace: 'nowrap' }}>{fmtDuration(duration)}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{liked ? myReaction : '🤍'}</span>
            <span style={{ whiteSpace: 'nowrap' }}>{likesCount} {t.reelsLikes}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>💬</span>
            <span style={{ whiteSpace: 'nowrap' }}>{Number(reel.comments_count)} {t.reelsComments}</span>
          </div>
          {reel.views_count > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>👁️</span>
              <span style={{ whiteSpace: 'nowrap' }}>{reel.views_count}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ t, onClose, onUploaded }) {
  const [videoFile, setVideoFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [caption, setCaption] = useState('')
  const [taggedUsers, setTaggedUsers] = useState([])
  const [tagSearch, setTagSearch] = useState('')
  const [tagResults, setTagResults] = useState([])
  const [showTagSearch, setShowTagSearch] = useState(false)
  const tagTimer = useRef(null)
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
      const data = await apiUploadReel(videoFile, caption.trim() || '', taggedUsers.length ? taggedUsers : undefined)
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

        {/* Tag people */}
        <div style={{ marginBottom: 14 }}>
          {taggedUsers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {taggedUsers.map(u => (
                <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 12, background: '#2a2a2a', border: '1px solid #2D6A4F', color: '#8ecfad' }}>
                  👤 {u.name}
                  <button type="button" onClick={() => setTaggedUsers(prev => prev.filter(x => x.id !== u.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setShowTagSearch(v => !v)}
            style={{ background: 'none', border: '1px solid #444', borderRadius: 8, padding: '6px 12px', color: taggedUsers.length > 0 ? '#8ecfad' : '#aaa', fontSize: 12, cursor: 'pointer' }}>
            👤 {t.reelsTagPeople || 'Tag people'}
          </button>
          {showTagSearch && (
            <div style={{ marginTop: 8 }}>
              <input autoFocus type="text" placeholder="🔍 Search…" value={tagSearch}
                onChange={e => {
                  setTagSearch(e.target.value)
                  clearTimeout(tagTimer.current)
                  if (e.target.value.trim().length >= 1) {
                    tagTimer.current = setTimeout(() => {
                      apiSearchUsers(e.target.value.trim()).then(r => setTagResults(r || []))
                    }, 300)
                  } else { setTagResults([]) }
                }}
                style={{ ...s.input, marginBottom: 6 }}
              />
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tagResults.map(u => {
                  const already = taggedUsers.some(x => x.id === u.id)
                  return (
                    <button key={u.id} type="button" onClick={() => {
                      if (!already) setTaggedUsers(prev => [...prev, { id: u.id, name: u.name, handle: u.handle }])
                      setTagSearch(''); setTagResults([]); setShowTagSearch(false)
                    }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: already ? '#1a2e1e' : '#2a2a2a', border: '1px solid #444', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: '#fff' }}>
                      <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{u.name[0]}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                        {u.handle && <div style={{ fontSize: 11, color: '#888' }}>@{u.handle}</div>}
                      </div>
                      {already && <span style={{ fontSize: 11, color: '#8ecfad' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

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
export default function ReelsPage({ t, currentUser, initialReelId, onViewProfile }) {
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

  useEffect(() => {
    if (!initialReelId || loading || reels.length === 0) return
    const el = document.getElementById(`reel-${initialReelId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [initialReelId, loading, reels])

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
        <div key={reel.id} id={`reel-${reel.id}`}>
          <ReelCard
            reel={reel}
            t={t}
            currentUser={currentUser}
            onDelete={handleDelete}
            onViewProfile={onViewProfile}
          />
        </div>
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
