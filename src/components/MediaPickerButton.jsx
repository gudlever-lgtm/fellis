import { useState, useEffect, useRef } from 'react'
import { getTranslations } from '../data.js'

function CameraModal({ lang, onCapture, onClose }) {
  const t = getTranslations(lang)
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const streamRef = useRef(null)
  const pinchRef = useRef(null)
  const focusTimerRef = useRef(null)
  const countdownRef = useRef(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [facingMode, setFacingMode] = useState('environment')
  const [zoom, setZoom] = useState(1)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [focusPoint, setFocusPoint] = useState(null)
  const [timerSecs, setTimerSecs] = useState(0)
  const [countdown, setCountdown] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function startCamera() {
      try {
        const isBack = facingMode === 'environment'
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
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
    startCamera()
    return () => {
      cancelled = true
      clearTimeout(focusTimerRef.current)
      clearInterval(countdownRef.current)
      streamRef.current?.getTracks().forEach(tr => tr.stop())
      streamRef.current = null
    }
  }, [facingMode])

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
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
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
        if (remaining <= 0) {
          clearInterval(countdownRef.current)
          setCountdown(null)
          doCapture()
        } else {
          setCountdown(remaining)
        }
      }, 1000)
    } else {
      doCapture()
    }
  }

  const cancelCountdown = () => {
    clearInterval(countdownRef.current)
    setCountdown(null)
  }

  const flipCamera = () => {
    cancelCountdown()
    streamRef.current?.getTracks().forEach(tr => tr.stop())
    streamRef.current = null
    setReady(false)
    setError(null)
    setFacingMode(f => f === 'environment' ? 'user' : 'environment')
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
    const ratio = Math.hypot(dx, dy) / pinchRef.current.startDist
    setZoom(Math.max(1, Math.min(5, pinchRef.current.startZoom * ratio)))
  }
  const handleTouchEnd = () => { pinchRef.current = null }

  const handleVideoClick = e => {
    if (!ready) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    setFocusPoint({ x: xPct, y: yPct })
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
  const noBlur = e => e.preventDefault()
  const isMirrored = facingMode === 'user'

  const s = {
    overlay: { position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    videoWrap: { position: 'relative', width: '100%', flex: '1 1 auto', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '70vh', touchAction: 'none' },
    video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: `${isMirrored ? 'scaleX(-1) ' : ''}scale(${zoom})`, transformOrigin: 'center' },
    controls: { width: '100%', maxWidth: 540, padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 },
    zoomRow: { display: 'flex', alignItems: 'center', gap: 8 },
    zoomLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
    zoomSlider: { flex: 1, accentColor: '#2D6A4F', cursor: 'pointer' },
    zoomPresets: { display: 'flex', gap: 6 },
    mainRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-around' },
    iconBtn: active => ({ width: 44, height: 44, borderRadius: '50%', background: active ? 'rgba(255,220,0,0.22)' : 'rgba(255,255,255,0.12)', color: active ? '#FFD700' : '#fff', border: `1px solid ${active ? 'rgba(255,220,0,0.45)' : 'rgba(255,255,255,0.2)'}`, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
    shutterBtn: { width: 68, height: 68, borderRadius: '50%', background: 'transparent', border: '4px solid rgba(255,255,255,0.65)', cursor: ready && countdown === null ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
    shutterInner: { width: 52, height: 52, borderRadius: '50%', background: ready ? (countdown !== null ? '#e74c3c' : '#fff') : '#555', transition: 'background 0.15s' },
    bottomRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    cancelBtn: { padding: '8px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 13 },
    timerBtn: active => ({ padding: '5px 12px', borderRadius: 12, background: active ? 'rgba(255,220,0,0.18)' : 'rgba(255,255,255,0.08)', color: active ? '#FFD700' : 'rgba(255,255,255,0.7)', border: `1px solid ${active ? 'rgba(255,220,0,0.4)' : 'transparent'}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    presetBtn: active => ({ padding: '4px 10px', borderRadius: 12, background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    countdown: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96, fontWeight: 900, color: '#fff', textShadow: '0 2px 32px rgba(0,0,0,0.9)', pointerEvents: 'none' },
    focusRing: fp => ({ position: 'absolute', left: `${fp.x}%`, top: `${fp.y}%`, width: 56, height: 56, transform: 'translate(-50%,-50%)', border: '2px solid rgba(255,200,0,0.9)', borderRadius: 6, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }),
    errorText: { color: '#fff', textAlign: 'center', maxWidth: 360, padding: 24 },
  }

  return (
    <div style={s.overlay} onMouseDown={noBlur}>
      {error ? (
        <div style={s.errorText}>
          <div style={{ fontSize: 17, marginBottom: 10 }}>{t.cameraNotAvailable}</div>
          <div style={{ fontSize: 13, opacity: 0.65, marginBottom: 20 }}>{error}</div>
          <button onMouseDown={noBlur} onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14 }}>{t.analyticsInsightClose}</button>
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
              <input
                type="range" min={1} max={5} step={0.1}
                value={zoom}
                onMouseDown={noBlur}
                onChange={e => setZoom(parseFloat(e.target.value))}
                style={s.zoomSlider}
              />
            </div>
            <div style={s.mainRow}>
              {torchSupported
                ? <button onMouseDown={noBlur} onClick={() => setTorchOn(v => !v)} style={s.iconBtn(torchOn)} title={t.cameraTorch}>⚡</button>
                : <div style={{ width: 44 }} />
              }
              <button onMouseDown={noBlur} onClick={flipCamera} style={s.iconBtn(false)} title={t.flipCamera}>🔄</button>
              <button onMouseDown={noBlur} onClick={countdown !== null ? cancelCountdown : capture} style={s.shutterBtn}>
                <div style={s.shutterInner} />
              </button>
              <button onMouseDown={noBlur} onClick={() => setShowGrid(v => !v)} style={s.iconBtn(showGrid)} title={t.cameraGrid}>⊞</button>
              <button onMouseDown={noBlur} onClick={cycleTimer} style={s.timerBtn(timerSecs > 0)} title={t.cameraTimer}>
                ⏱ {timerSecs > 0 ? `${timerSecs}s` : t.cameraTimerOff}
              </button>
            </div>
            <div style={s.bottomRow}>
              <div style={s.zoomPresets}>
                {[1, 2, 3].map(z => (
                  <button key={z} onMouseDown={noBlur} onClick={() => setZoom(z)} style={s.presetBtn(Math.abs(zoom - z) < 0.15)}>{z}×</button>
                ))}
              </div>
              <button onMouseDown={noBlur} onClick={countdown !== null ? cancelCountdown : onClose} style={s.cancelBtn}>
                {t.adminModKeywordCancel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function MediaPickerButton({ lang, onFiles, accept = 'image/*,video/*', multiple = true, align = 'left', direction = 'up', buttonContent }) {
  const t = getTranslations(lang)
  const [open, setOpen] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const fileRef = useRef(null)
  const pickGallery = () => { fileRef.current?.click(); setOpen(false) }
  const pickCamera = () => { setOpen(false); setShowCamera(true) }
  return (
    <div className="p-media-popup-wrap">
      <button
        type="button"
        className={`p-media-popup-btn${open ? ' active' : ''}`}
        onMouseDown={e => e.preventDefault()}
        onTouchStart={() => { if (document.activeElement) document.activeElement.blur() }}
        onClick={() => setOpen(p => !p)}
        title={t.addMedia}
      >{buttonContent ?? '+'}</button>
      {open && (
        <>
          <div className="p-share-backdrop" onClick={() => setOpen(false)} />
          <div className={`p-share-popup p-media-popup${align === 'right' ? ' p-media-popup-right' : ''}${direction === 'down' ? ' p-media-popup-down' : ''}`}>
            <button className="p-share-option" type="button" onMouseDown={e => e.preventDefault()} onClick={pickGallery}>
              <span className="p-media-popup-icon">🖼️</span>
              {t.gallery}
            </button>
            <button className="p-share-option" type="button" onMouseDown={e => e.preventDefault()} onClick={pickCamera}>
              <span className="p-media-popup-icon">📷</span>
              {t.camera}
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }}
        onChange={e => { onFiles(Array.from(e.target.files).filter(Boolean)); e.target.value = '' }} />
      {showCamera && (
        <CameraModal
          lang={lang}
          onCapture={file => { setShowCamera(false); onFiles([file]) }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  )
}
