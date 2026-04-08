import { useState, useEffect, useRef, useCallback } from 'react'
import {
  apiGetConversations, apiGetMessages, apiSendMessage,
  apiUploadFile, apiRenameConversation, apiAddParticipants, apiSearchUsers,
  apiLeaveConversation, apiMuteConversation,
  apiRemoveParticipant, apiMuteParticipant,
} from './api.js'
import { t } from './data.js'

const POLL_INTERVAL = 5000
const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || ''

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

// ── Camera modal ──────────────────────────────────────────────────────────────
// Features: pinch-to-zoom, tap-to-focus, torch toggle, grid overlay, countdown timer, selfie mirror
function CameraModal({ lang, onCapture, onClose }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const streamRef = useRef(null)
  const pinchRef = useRef(null)
  const focusTimerRef = useRef(null)
  const countdownRef = useRef(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [facing, setFacing] = useState('environment')
  const [zoom, setZoom] = useState(1)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [focusPoint, setFocusPoint] = useState(null)
  const [timerSecs, setTimerSecs] = useState(0)
  const [countdown, setCountdown] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const isBack = facing === 'environment'
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: isBack ? 1920 : 1280 },
            height: { ideal: isBack ? 1080 : 720 },
          },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() || {}
        setTorchSupported(!!caps.torch)
        setTorchOn(false)
        setZoom(1)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => { if (!cancelled) setReady(true) }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      }
    }
    start()
    return () => {
      cancelled = true
      clearTimeout(focusTimerRef.current)
      clearInterval(countdownRef.current)
      streamRef.current?.getTracks().forEach(tr => tr.stop())
      streamRef.current = null
    }
  }, [facing])

  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const caps = track.getCapabilities?.() || {}
    if (caps.zoom) {
      const clamped = Math.max(caps.zoom.min, Math.min(caps.zoom.max, zoom))
      track.applyConstraints({ advanced: [{ zoom: clamped }] }).catch(() => {})
    }
  }, [zoom])

  useEffect(() => {
    if (!torchSupported) return
    const track = streamRef.current?.getVideoTracks()[0]
    if (track) track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {})
  }, [torchOn, torchSupported])

  const doCapture = () => {
    const video = videoRef.current
    if (!video || !ready) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      streamRef.current?.getTracks().forEach(tr => tr.stop())
      onCapture(file)
    }, 'image/jpeg', 0.92)
  }

  const capture = () => {
    if (!ready || countdown !== null) return
    if (timerSecs > 0) {
      setCountdown(timerSecs)
      let remaining = timerSecs
      countdownRef.current = setInterval(() => {
        remaining -= 1
        if (remaining <= 0) { clearInterval(countdownRef.current); setCountdown(null); doCapture() }
        else setCountdown(remaining)
      }, 1000)
    } else {
      doCapture()
    }
  }

  const cancelCountdown = () => { clearInterval(countdownRef.current); setCountdown(null) }

  const flip = () => {
    cancelCountdown()
    streamRef.current?.getTracks().forEach(tr => tr.stop())
    streamRef.current = null
    setReady(false); setError(null)
    setFacing(f => f === 'environment' ? 'user' : 'environment')
  }

  const handleTouchStart = e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchRef.current = { startDist: Math.hypot(dx, dy), startZoom: zoom }
    }
  }
  const handleTouchMove = e => {
    if (e.touches.length !== 2 || !pinchRef.current) return
    e.preventDefault()
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    setZoom(Math.max(1, Math.min(5, pinchRef.current.startZoom * (Math.hypot(dx, dy) / pinchRef.current.startDist))))
  }
  const handleTouchEnd = () => { pinchRef.current = null }

  const handleVideoClick = e => {
    if (!ready) return
    const rect = e.currentTarget.getBoundingClientRect()
    setFocusPoint({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
    clearTimeout(focusTimerRef.current)
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 1500)
    const track = streamRef.current?.getVideoTracks()[0]
    if (track) {
      const nx = (e.clientX - rect.left) / rect.width
      const ny = (e.clientY - rect.top) / rect.height
      track.applyConstraints({ advanced: [{ focusMode: 'manual', pointsOfInterest: [{ x: nx, y: ny }] }] }).catch(() => {})
    }
  }

  const cycleTimer = () => setTimerSecs(s => s === 0 ? 3 : s === 3 ? 10 : 0)
  const isMirrored = facing === 'user'

  const s = {
    overlay: { position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    videoWrap: { position: 'relative', width: '100%', flex: '1 1 auto', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '70vh', touchAction: 'none' },
    video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: `${isMirrored ? 'scaleX(-1) ' : ''}scale(${zoom})`, transformOrigin: 'center' },
    controls: { width: '100%', maxWidth: 540, padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 },
    zoomRow: { display: 'flex', alignItems: 'center', gap: 8 },
    zoomLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
    mainRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-around' },
    iconBtn: active => ({ width: 44, height: 44, borderRadius: '50%', background: active ? 'rgba(255,220,0,0.22)' : 'rgba(255,255,255,0.12)', color: active ? '#FFD700' : '#fff', border: `1px solid ${active ? 'rgba(255,220,0,0.45)' : 'rgba(255,255,255,0.2)'}`, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
    shutterBtn: { width: 68, height: 68, borderRadius: '50%', background: 'transparent', border: '4px solid rgba(255,255,255,0.65)', cursor: ready && countdown === null ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
    shutterInner: { width: 52, height: 52, borderRadius: '50%', background: ready ? (countdown !== null ? '#e74c3c' : '#fff') : '#555', transition: 'background 0.15s' },
    bottomRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    presets: { display: 'flex', gap: 6 },
    presetBtn: active => ({ padding: '4px 10px', borderRadius: 12, background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    timerBtn: active => ({ padding: '5px 12px', borderRadius: 12, background: active ? 'rgba(255,220,0,0.18)' : 'rgba(255,255,255,0.08)', color: active ? '#FFD700' : 'rgba(255,255,255,0.7)', border: `1px solid ${active ? 'rgba(255,220,0,0.4)' : 'transparent'}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    cancelBtn: { padding: '8px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 13 },
    countdown: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96, fontWeight: 900, color: '#fff', textShadow: '0 2px 32px rgba(0,0,0,0.9)', pointerEvents: 'none' },
    focusRing: fp => ({ position: 'absolute', left: `${fp.x}%`, top: `${fp.y}%`, width: 56, height: 56, transform: 'translate(-50%,-50%)', border: '2px solid rgba(255,200,0,0.9)', borderRadius: 6, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }),
    errorText: { color: '#fff', textAlign: 'center', maxWidth: 360, padding: 24 },
  }

  return (
    <div style={s.overlay}>
      {error ? (
        <div style={s.errorText}>
          <div style={{ fontSize: 17, marginBottom: 10 }}>{t(lang, 'cameraNotAvailable')}</div>
          <div style={{ fontSize: 13, opacity: 0.65, marginBottom: 20 }}>{error}</div>
          <button onClick={onClose} style={s.cancelBtn}>{t(lang, 'close')}</button>
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            style={s.videoWrap}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={handleVideoClick}
          >
            <video ref={videoRef} autoPlay playsInline muted style={s.video} />
            {showGrid && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
                <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
                <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
                <line x1="0" y1="66.6" x2="100" y2="66.6" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
              </svg>
            )}
            {focusPoint && <div style={s.focusRing(focusPoint)} />}
            {countdown !== null && <div style={s.countdown}>{countdown}</div>}
          </div>

          <div style={s.controls}>
            <div style={s.zoomRow}>
              <span style={s.zoomLabel}>{zoom.toFixed(1)}×</span>
              <input type="range" min={1} max={5} step={0.1} value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} style={{ flex: 1, accentColor: '#1877f2', cursor: 'pointer' }} />
            </div>
            <div style={s.mainRow}>
              {torchSupported
                ? <button onClick={() => setTorchOn(v => !v)} style={s.iconBtn(torchOn)} title={t(lang, 'cameraTorch')}>⚡</button>
                : <div style={{ width: 44 }} />
              }
              <button onClick={flip} style={s.iconBtn(false)} title={t(lang, 'flipCamera')}>🔄</button>
              <button onClick={countdown !== null ? cancelCountdown : capture} style={s.shutterBtn}>
                <div style={s.shutterInner} />
              </button>
              <button onClick={() => setShowGrid(v => !v)} style={s.iconBtn(showGrid)} title={t(lang, 'cameraGrid')}>⊞</button>
              <button onClick={cycleTimer} style={s.timerBtn(timerSecs > 0)} title={t(lang, 'cameraTimer')}>
                ⏱ {timerSecs > 0 ? `${timerSecs}s` : t(lang, 'cameraTimerOff')}
              </button>
            </div>
            <div style={s.bottomRow}>
              <div style={s.presets}>
                {[1, 2, 3].map(z => (
                  <button key={z} onClick={() => setZoom(z)} style={s.presetBtn(Math.abs(zoom - z) < 0.15)}>{z}×</button>
                ))}
              </div>
              <button onClick={countdown !== null ? cancelCountdown : onClose} style={s.cancelBtn}>{t(lang, 'cancel')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Media picker button (gallery + camera) ────────────────────────────────────
function MediaPickerButton({ lang, onFiles }) {
  const [open, setOpen] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const fileRef = useRef(null)

  const s = {
    wrap: { position: 'relative', display: 'inline-block' },
    btn: { width: 36, height: 36, borderRadius: '50%', background: '#e8f0fe', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    popup: { position: 'absolute', bottom: 44, left: 0, background: '#fff', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', overflow: 'hidden', minWidth: 140, zIndex: 100 },
    option: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', border: 'none', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: 14, color: '#222' },
    backdrop: { position: 'fixed', inset: 0, zIndex: 99 },
  }

  return (
    <div style={s.wrap}>
      <button style={s.btn} type="button" title={t(lang, 'addMedia')} onClick={() => setOpen(p => !p)}>🖼️</button>
      {open && (
        <>
          <div style={s.backdrop} onClick={() => setOpen(false)} />
          <div style={s.popup}>
            <button style={s.option} type="button" onClick={() => { fileRef.current?.click(); setOpen(false) }}>
              <span>🖼️</span>{t(lang, 'gallery')}
            </button>
            <button style={s.option} type="button" onClick={() => { setShowCamera(true); setOpen(false) }}>
              <span>📷</span>{t(lang, 'camera')}
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
        onChange={e => { onFiles(Array.from(e.target.files).filter(Boolean)); e.target.value = '' }} />
      {showCamera && (
        <CameraModal lang={lang}
          onCapture={file => { setShowCamera(false); onFiles([file]) }}
          onClose={() => setShowCamera(false)} />
      )}
    </div>
  )
}

// ── Rename modal ──────────────────────────────────────────────────────────────
function RenameModal({ lang, currentName, onSave, onClose }) {
  const [name, setName] = useState(currentName || '')
  const [saving, setSaving] = useState(false)

  const s = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    box: { background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 340, boxShadow: '0 4px 24px rgba(0,0,0,0.14)' },
    title: { fontWeight: 700, fontSize: 16, marginBottom: 16 },
    input: { width: '100%', padding: '9px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none' },
    row: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' },
    btnCancel: { padding: '8px 16px', borderRadius: 8, border: '1.5px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 },
    btnSave: { padding: '8px 20px', borderRadius: 8, background: '#1877f2', color: '#fff', border: 'none', cursor: saving ? 'default' : 'pointer', fontSize: 14, fontWeight: 700 },
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    await onSave(name.trim())
    setSaving(false)
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.box}>
        <div style={s.title}>{t(lang, 'renameConversation')}</div>
        <input style={s.input} value={name} onChange={e => setName(e.target.value)}
          placeholder={t(lang, 'newName')} autoFocus
          onKeyDown={e => e.key === 'Enter' && handleSave()} />
        <div style={s.row}>
          <button style={s.btnCancel} onClick={onClose}>{t(lang, 'cancel')}</button>
          <button style={s.btnSave} onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? t(lang, 'saving') : t(lang, 'save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add people modal ──────────────────────────────────────────────────────────
function AddPeopleModal({ lang, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await apiSearchUsers(query.trim())
      setResults(Array.isArray(res) ? res : (res?.users || []))
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function handleAdd() {
    if (!selected.length) return
    setAdding(true)
    setError('')
    const res = await onAdd(selected.map(u => u.id))
    setAdding(false)
    if (res?.error) { setError(t(lang, 'addError')); return }
    onClose()
  }

  const toggle = user => setSelected(prev =>
    prev.find(u => u.id === user.id) ? prev.filter(u => u.id !== user.id) : [...prev, user])

  const s = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    box: { background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.14)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
    title: { fontWeight: 700, fontSize: 16, marginBottom: 12, flexShrink: 0 },
    input: { width: '100%', padding: '9px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none', marginBottom: 8, flexShrink: 0 },
    list: { flex: 1, overflowY: 'auto', marginBottom: 8 },
    item: (sel) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid #f4f4f4', cursor: 'pointer', background: sel ? '#e8f0fe' : 'transparent', borderRadius: 6 }),
    avatar: (name) => ({ width: 34, height: 34, borderRadius: '50%', background: strColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }),
    name: { fontSize: 14, fontWeight: 500 },
    row: { display: 'flex', gap: 8, marginTop: 4, justifyContent: 'flex-end', flexShrink: 0 },
    btnCancel: { padding: '8px 16px', borderRadius: 8, border: '1.5px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 },
    btnAdd: { padding: '8px 20px', borderRadius: 8, background: selected.length ? '#1877f2' : '#aaa', color: '#fff', border: 'none', cursor: selected.length ? 'pointer' : 'default', fontSize: 14, fontWeight: 700 },
    errorText: { color: '#d32f2f', fontSize: 12, marginBottom: 4 },
    emptyText: { color: '#aaa', fontSize: 13, textAlign: 'center', padding: '12px 0' },
    chip: { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#e8f0fe', borderRadius: 20, padding: '3px 10px 3px 8px', fontSize: 12, marginBottom: 6, marginRight: 4 },
    chipX: { cursor: 'pointer', color: '#666', fontSize: 14, marginLeft: 2, lineHeight: 1 },
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.box}>
        <div style={s.title}>{t(lang, 'addPeople')}</div>
        {selected.length > 0 && (
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            {selected.map(u => (
              <span key={u.id} style={s.chip}>
                {u.name}
                <span style={s.chipX} onClick={() => toggle(u)}>×</span>
              </span>
            ))}
          </div>
        )}
        <input style={s.input} placeholder={t(lang, 'searchUsers')} value={query}
          onChange={e => setQuery(e.target.value)} autoFocus />
        <div style={s.list}>
          {results.length === 0 && query.trim() && (
            <div style={s.emptyText}>{t(lang, 'noUsersFound')}</div>
          )}
          {results.map(user => {
            const sel = !!selected.find(u => u.id === user.id)
            return (
              <div key={user.id} style={s.item(sel)} onClick={() => toggle(user)}>
                <div style={s.avatar(user.name)}>{initials(user.name)}</div>
                <span style={s.name}>{user.name}</span>
                {sel && <span style={{ marginLeft: 'auto', color: '#1877f2', fontSize: 16 }}>✓</span>}
              </div>
            )
          })}
        </div>
        {error && <div style={s.errorText}>{error}</div>}
        <div style={s.row}>
          <button style={s.btnCancel} onClick={onClose}>{t(lang, 'cancel')}</button>
          <button style={s.btnAdd} onClick={handleAdd} disabled={adding || !selected.length}>
            {adding ? t(lang, 'adding') : t(lang, 'add')}
          </button>
        </div>
      </div>
    </div>
  )
}

const MUTE_OPTIONS = [
  { key: 'min30',  minutes: 30 },
  { key: 'hour1',  minutes: 60 },
  { key: 'hours4', minutes: 240 },
  { key: 'day1',   minutes: 1440 },
  { key: 'week1',  minutes: 10080 },
]

// ── Members modal ─────────────────────────────────────────────────────────────
function MembersModal({ lang, participants, convId, myUserId, onRemove, onMute, onClose }) {
  const [muteMenu, setMuteMenu] = useState(null) // participant id showing mute submenu

  const s = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    box: { background: '#fff', borderRadius: 12, padding: '20px 16px', width: '100%', maxWidth: 340, boxShadow: '0 4px 24px rgba(0,0,0,0.14)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
    title: { fontWeight: 700, fontSize: 16, marginBottom: 12, flexShrink: 0, paddingLeft: 4 },
    list: { flex: 1, overflowY: 'auto' },
    item: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid #f4f4f4' },
    avatar: (name) => ({ width: 36, height: 36, borderRadius: '50%', background: strColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }),
    nameWrap: { flex: 1, minWidth: 0 },
    name: { fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    profileLink: { fontSize: 11, color: '#1877f2', textDecoration: 'none', display: 'block', marginTop: 1 },
    actions: { display: 'flex', gap: 6, flexShrink: 0 },
    muteBtn: { padding: '4px 8px', borderRadius: 6, background: '#f0f0f0', border: 'none', fontSize: 12, cursor: 'pointer', color: '#555' },
    removeBtn: { padding: '4px 8px', borderRadius: 6, background: '#fdecea', border: 'none', fontSize: 12, cursor: 'pointer', color: '#d32f2f' },
    mutePopup: { position: 'absolute', right: 0, top: '100%', background: '#fff', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.14)', zIndex: 10, minWidth: 140, overflow: 'hidden' },
    muteOption: { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '10px 14px', fontSize: 13, cursor: 'pointer', color: '#222' },
    closeBtn: { marginTop: 14, padding: '9px 0', width: '100%', borderRadius: 8, border: '1.5px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.box}>
        <div style={s.title}>{t(lang, 'members')} ({participants?.length ?? 0})</div>
        <div style={s.list}>
          {(participants || []).map(p => (
            <div key={p.id} style={{ ...s.item, position: 'relative' }}>
              <div style={s.avatar(p.name)}>{initials(p.name)}</div>
              <div style={s.nameWrap}>
                <div style={s.name}>{p.name}</div>
                <a href={`https://fellis.eu/?profile=${p.id}`} target="_blank" rel="noopener noreferrer" style={s.profileLink}>
                  {lang === 'da' ? 'Vis profil' : 'View profile'}
                </a>
              </div>
              {p.id !== myUserId && (
                <div style={s.actions}>
                  <div style={{ position: 'relative' }}>
                    <button style={s.muteBtn} onClick={() => setMuteMenu(muteMenu === p.id ? null : p.id)}>
                      🔇
                    </button>
                    {muteMenu === p.id && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setMuteMenu(null)} />
                        <div style={s.mutePopup}>
                          {MUTE_OPTIONS.map(o => (
                            <button key={o.key} style={s.muteOption} onClick={() => { onMute(p.id, o.minutes); setMuteMenu(null) }}>
                              {t(lang, o.key)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button style={s.removeBtn} onClick={() => onRemove(p.id)}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button style={s.closeBtn} onClick={onClose}>{t(lang, 'cancel')}</button>
      </div>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────
function initials(name = '') {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
}
function strColor(name = '') {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  const hue = Math.abs(h) % 360
  return `hsl(${hue},55%,42%)`
}
function convDisplayName(conv, lang) {
  const n = conv.name
  if (!n || n === 'Ukendt') return lang === 'en' ? 'Unknown' : 'Ukendt'
  return n
}
function mediaUrl(url) {
  if (!url) return url
  if (url.startsWith('http')) return url
  return `${API_BASE}${url}`
}

// ── Lightbox modal ────────────────────────────────────────────────────────────
function LightboxModal({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', objectFit: 'contain' }}
        onClick={e => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{ position: 'fixed', top: 16, right: 18, background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1, opacity: 0.8 }}
      >×</button>
    </div>
  )
}

// ── Main Chat component ───────────────────────────────────────────────────────
export default function Chat({ lang, user, onLogout }) {
  const [conversations, setConversations] = useState([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [convError, setConvError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgError, setMsgError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [media, setMedia] = useState([]) // [{url, type, mime, preview}]
  const [uploading, setUploading] = useState(false)
  const [modal, setModal] = useState(null) // null | 'rename' | 'addPeople' | 'members'
  const [lightbox, setLightbox] = useState(null) // url string or null
  const messagesEndRef = useRef(null)
  const pollRef = useRef(null)
  const isMobile = useIsMobile()

  const loadConversations = useCallback(async () => {
    const res = await apiGetConversations()
    if (!res || res.error) {
      setConvError(t(lang, 'errorLoadConversations'))
    } else {
      setConversations(Array.isArray(res) ? res : [])
      setConvError('')
    }
    setLoadingConvs(false)
  }, [lang])

  const loadMessages = useCallback(async (convId) => {
    setLoadingMsgs(true)
    setMsgError('')
    const res = await apiGetMessages(convId)
    if (!res || res.error) {
      setMsgError(t(lang, 'errorLoadMessages'))
    } else {
      setMessages(res.messages || [])
    }
    setLoadingMsgs(false)
  }, [lang])

  const pollMessages = useCallback(async (convId) => {
    const res = await apiGetMessages(convId)
    if (res && !res.error) setMessages(res.messages || [])
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    if (!selectedId) return
    loadMessages(selectedId)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => pollMessages(selectedId), POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [selectedId, loadMessages, pollMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleMediaFiles = useCallback(async (files) => {
    const allowed = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!allowed.length) return
    setUploading(true)
    const results = await Promise.all(allowed.map(async f => {
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
      const uploaded = await apiUploadFile(f)
      if (!uploaded?.url) return null
      return { url: uploaded.url, type: uploaded.type, mime: uploaded.mime || f.type, preview }
    }))
    setMedia(prev => [...prev, ...results.filter(Boolean)])
    setUploading(false)
  }, [])

  async function handleSend(e) {
    e?.preventDefault()
    if (!draft.trim() && !media.length) return
    if (!selectedId) return
    setSendError('')
    setSending(true)
    const mediaPayload = media.length ? media.map(({ url, type, mime }) => ({ url, type, mime })) : null
    const res = await apiSendMessage(selectedId, draft.trim(), mediaPayload, lang)
    setSending(false)
    if (!res || res.error) {
      setSendError(t(lang, 'sendError'))
    } else {
      setDraft('')
      setMedia([])
      await pollMessages(selectedId)
    }
  }

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter(item => item.type.startsWith('image/'))
    if (!imageItems.length) return
    e.preventDefault()
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean)
    if (files.length) handleMediaFiles(files)
  }

  async function handleRename(name) {
    if (!selectedId) return
    const res = await apiRenameConversation(selectedId, name)
    if (!res?.error) {
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, name, groupName: name } : c))
    }
    setModal(null)
  }

  async function handleAddPeople(userIds) {
    if (!selectedId) return
    const res = await apiAddParticipants(selectedId, userIds)
    setModal(null)
    return res
  }

  async function handleRemoveMember(userId) {
    if (!selectedId) return
    if (!window.confirm(t(lang, 'removeConfirm'))) return
    await apiRemoveParticipant(selectedId, userId)
    setConversations(prev => prev.map(c =>
      c.id === selectedId ? { ...c, participants: c.participants.filter(p => p.id !== userId) } : c))
  }

  async function handleMuteMember(userId, minutes) {
    if (!selectedId) return
    await apiMuteParticipant(selectedId, userId, minutes)
  }

  async function handleLeave() {
    const conv = selectedConv
    if (!conv) return
    const confirmKey = conv.isGroup ? 'leaveConfirm' : 'deleteConfirm'
    if (!window.confirm(t(lang, confirmKey))) return
    await apiLeaveConversation(selectedId)
    setSelectedId(null)
    await loadConversations()
  }

  async function handleMute() {
    const conv = selectedConv
    if (!conv) return
    const isMuted = conv.mutedUntil && new Date(conv.mutedUntil) > new Date()
    // unmute = null, mute = 525600 minutes (1 year ≈ indefinite)
    const res = await apiMuteConversation(conv.id, isMuted ? null : 525600)
    if (res && !res.error) {
      setConversations(prev => prev.map(c =>
        c.id === conv.id ? { ...c, mutedUntil: isMuted ? null : res.mutedUntil } : c))
    }
  }

  const selectedConv = conversations.find(c => c.id === selectedId)
  const myName = user?.name || ''

  const s = {
    root: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f4f5f7' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 52, background: '#1877f2', color: '#fff', flexShrink: 0 },
    headerTitle: { fontWeight: 700, fontSize: 18 },
    headerRight: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 },
    logoutBtn: { background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 13 },
    body: { display: 'flex', flex: 1, overflow: 'hidden', flexDirection: isMobile ? 'column' : 'row' },
    sidebar: { width: isMobile ? '100%' : 280, flexShrink: 0, background: '#fff', borderRight: isMobile ? 'none' : '1.5px solid #eee', borderBottom: isMobile ? '1.5px solid #eee' : 'none', display: isMobile && selectedId ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' },
    sidebarHeader: { padding: '14px 16px 10px', fontWeight: 700, fontSize: 14, color: '#333', borderBottom: '1px solid #f0f0f0', flexShrink: 0 },
    convList: { flex: 1, overflowY: 'auto' },
    convItem: (active) => ({ padding: '12px 16px', cursor: 'pointer', background: active ? '#e8f0fe' : 'transparent', borderBottom: '1px solid #f4f4f4', transition: 'background 0.12s' }),
    convName: { fontWeight: 600, fontSize: 14, color: '#222', marginBottom: 2 },
    convMeta: { fontSize: 12, color: '#888' },
    unreadBadge: { display: 'inline-block', background: '#1877f2', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700, marginLeft: 6 },
    mainPanel: { flex: 1, display: isMobile && !selectedId ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' },
    threadHeader: { padding: '10px 14px', fontWeight: 700, fontSize: 15, borderBottom: '1.5px solid #eee', background: '#fff', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
    backBtn: { background: 'none', border: 'none', color: '#1877f2', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '2px 6px' },
    menuBtn: { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#555', padding: '2px 6px', borderRadius: 6, lineHeight: 1 },
    menuDropdown: { position: 'absolute', right: 8, top: 52, background: '#fff', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', zIndex: 100, minWidth: 160, overflow: 'hidden' },
    menuItem: { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '12px 16px', fontSize: 14, cursor: 'pointer', color: '#222' },
    messageList: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 },
    bubble: (mine) => ({ maxWidth: '72%', alignSelf: mine ? 'flex-end' : 'flex-start', background: mine ? '#1877f2' : '#fff', color: mine ? '#fff' : '#222', borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '8px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', fontSize: 14 }),
    senderName: { fontSize: 11, fontWeight: 600, marginBottom: 2, opacity: 0.75 },
    bubbleMeta: { fontSize: 11, opacity: 0.65, marginTop: 3, textAlign: 'right' },
    mediaImg: { maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block', marginTop: 4, cursor: 'pointer' },
    mediaVideo: { maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block', marginTop: 4 },
    inputArea: { background: '#fff', borderTop: '1.5px solid #eee', flexShrink: 0 },
    mediaPreview: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 12px 4px', borderBottom: '1px solid #f0f0f0' },
    previewThumb: { position: 'relative', width: 52, height: 52, borderRadius: 6, overflow: 'hidden', border: '1px solid #ddd', flexShrink: 0 },
    removeBtn: { position: 'absolute', top: 1, right: 1, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 },
    inputRow: { display: 'flex', alignItems: 'flex-end', gap: 6, padding: '8px 12px' },
    textInput: { flex: 1, padding: '9px 14px', border: '1.5px solid #ddd', borderRadius: 20, fontSize: 14, outline: 'none', background: '#f8f9fa', resize: 'none', lineHeight: 1.4, maxHeight: 100, overflowY: 'auto' },
    sendBtn: (disabled) => ({ padding: '9px 18px', background: disabled ? '#aac8f7' : '#1877f2', color: '#fff', border: 'none', borderRadius: 20, fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }),
    placeholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 15 },
    infoText: { textAlign: 'center', color: '#aaa', fontSize: 13, padding: 20 },
    errorText: { textAlign: 'center', color: '#d32f2f', fontSize: 13, padding: '8px 16px' },
  }

  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.headerTitle}>{t(lang, 'appName')}</span>
        <div style={s.headerRight}>
          <span>{myName}</span>
          <button style={s.logoutBtn} onClick={onLogout}>{t(lang, 'logout')}</button>
        </div>
      </div>

      <div style={s.body}>
        {/* Conversation list */}
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>{t(lang, 'conversations')}</div>
          <div style={s.convList}>
            {loadingConvs && <div style={s.infoText}>{t(lang, 'loadingConversations')}</div>}
            {convError && <div style={s.errorText}>{convError}</div>}
            {!loadingConvs && !convError && conversations.length === 0 && (
              <div style={s.infoText}>{t(lang, 'noConversations')}</div>
            )}
            {conversations.map(conv => (
              <div key={conv.id} style={s.convItem(conv.id === selectedId)}
                onClick={() => { setSelectedId(conv.id); setMenuOpen(false) }}>
                <div style={s.convName}>
                  {convDisplayName(conv, lang)}
                  {conv.unread > 0 && <span style={s.unreadBadge}>{conv.unread}</span>}
                </div>
                {conv.isGroup && <div style={s.convMeta}>{t(lang, 'group')}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Message thread */}
        <div style={s.mainPanel}>
          {!selectedId ? (
            <div style={s.placeholder}>{t(lang, 'selectConversation')}</div>
          ) : (
            <>
              <div style={{ ...s.threadHeader, position: 'relative' }}>
                {isMobile && (
                  <button style={s.backBtn} onClick={() => setSelectedId(null)}>
                    ← {t(lang, 'backToList')}
                  </button>
                )}
                <span>{convDisplayName(selectedConv || {}, lang)}</span>
                <button style={s.menuBtn} title={t(lang, 'options')}
                  onClick={() => setMenuOpen(p => !p)}>⋯</button>
                {menuOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(false)} />
                    <div style={s.menuDropdown}>
                      {selectedConv?.isGroup && (
                        <button style={s.menuItem} onClick={() => { setModal('members'); setMenuOpen(false) }}>
                          👥 {t(lang, 'viewMembers')}
                        </button>
                      )}
                      <button style={s.menuItem} onClick={() => { setModal('addPeople'); setMenuOpen(false) }}>
                        👤+ {t(lang, 'addPeople')}
                      </button>
                      {selectedConv?.isGroup && (
                        <button style={s.menuItem} onClick={() => { setModal('rename'); setMenuOpen(false) }}>
                          ✏️ {t(lang, 'rename')}
                        </button>
                      )}
                      <button style={s.menuItem} onClick={() => { handleMute(); setMenuOpen(false) }}>
                        🔔 {selectedConv?.mutedUntil && new Date(selectedConv.mutedUntil) > new Date()
                          ? t(lang, 'unmuteNotifications')
                          : t(lang, 'muteNotifications')}
                      </button>
                      <button style={{ ...s.menuItem, color: '#d32f2f' }} onClick={() => { handleLeave(); setMenuOpen(false) }}>
                        🚪 {selectedConv?.isGroup ? t(lang, 'leaveGroup') : t(lang, 'deleteChat')}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div style={s.messageList}>
                {loadingMsgs && <div style={s.infoText}>{t(lang, 'loadingMessages')}</div>}
                {msgError && <div style={s.errorText}>{msgError}</div>}
                {!loadingMsgs && !msgError && messages.length === 0 && (
                  <div style={s.infoText}>{t(lang, 'noMessages')}</div>
                )}
                {messages.map((msg, i) => {
                  const mine = msg.from === myName
                  const text = msg.text?.[lang] || msg.text?.da || msg.text?.en || ''
                  const showAvatar = !mine && (i === 0 || messages[i - 1]?.from !== msg.from)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: mine ? 'row-reverse' : 'row' }}>
                      {!mine && (
                        <div style={{ width: 28, flexShrink: 0 }}>
                          {showAvatar && (
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: strColor(msg.from), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11 }}>
                              {initials(msg.from)}
                            </div>
                          )}
                        </div>
                      )}
                    <div style={s.bubble(mine)}>
                      {!mine && showAvatar && <div style={s.senderName}>{msg.from}</div>}
                      {text && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>}
                      {msg.media?.length > 0 && msg.media.map((m, mi) => (
                        m.type === 'video'
                          ? <video key={mi} src={mediaUrl(m.url)} style={s.mediaVideo} controls />
                          : <img key={mi} src={mediaUrl(m.url)} style={{ ...s.mediaImg, cursor: 'zoom-in' }} alt=""
                              onClick={() => setLightbox(mediaUrl(m.url))} />
                      ))}
                      <div style={s.bubbleMeta}>{msg.time}</div>
                    </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div style={s.inputArea}>
                {(media.length > 0 || uploading) && (
                  <div style={s.mediaPreview}>
                    {media.map((m, i) => (
                      <div key={i} style={s.previewThumb}>
                        {m.type === 'image'
                          ? <img src={m.preview || mediaUrl(m.url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                          : <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎬</div>
                        }
                        <button style={s.removeBtn} onClick={() => setMedia(prev => prev.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    {uploading && <div style={{ ...s.previewThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', fontSize: 18 }}>⏳</div>}
                  </div>
                )}
                <form style={s.inputRow} onSubmit={handleSend}>
                  <MediaPickerButton lang={lang} onFiles={handleMediaFiles} />
                  <textarea
                    style={s.textInput}
                    rows={1}
                    placeholder={t(lang, 'typeMessage')}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    onPaste={handlePaste}
                    disabled={sending}
                  />
                  <button style={s.sendBtn(sending || (!draft.trim() && !media.length))} type="submit"
                    disabled={sending || (!draft.trim() && !media.length)}>
                    {sending ? t(lang, 'sending') : t(lang, 'send')}
                  </button>
                </form>
                {sendError && <div style={s.errorText}>{sendError}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {modal === 'members' && (
        <MembersModal lang={lang}
          participants={selectedConv?.participants}
          convId={selectedId}
          myUserId={user?.id}
          onRemove={handleRemoveMember}
          onMute={handleMuteMember}
          onClose={() => setModal(null)} />
      )}
      {modal === 'rename' && (
        <RenameModal lang={lang}
          currentName={selectedConv?.groupName || selectedConv?.name || ''}
          onSave={handleRename}
          onClose={() => setModal(null)} />
      )}
      {modal === 'addPeople' && (
        <AddPeopleModal lang={lang}
          onAdd={handleAddPeople}
          onClose={() => setModal(null)} />
      )}
      {lightbox && <LightboxModal src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
