import { useEffect, useRef } from 'react'

const COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#1dd1a1', '#ee5a24', '#f368e0', '#00d2d3', '#ff9f43']

function makeParticle(W) {
  return {
    x: Math.random() * W,
    y: -10 - Math.random() * 80,
    w: 7 + Math.random() * 11,
    h: 4 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    vx: (Math.random() - 0.5) * 5,
    vy: 1.5 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.25,
    spin: Math.random() > 0.5,
  }
}

/**
 * PartyConfetti — full-screen confetti rain for 5 seconds.
 * Dismisses on click.
 */
export default function PartyConfetti({ onDismiss }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = W
    canvas.height = H

    const particles = Array.from({ length: 180 }, () => makeParticle(W))

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      particles.forEach((p, idx) => {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.globalAlpha = 0.9
        if (p.spin) {
          // ribbon-like piece
          ctx.fillRect(-p.w / 2, -p.h / 4, p.w, p.h / 2)
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        }
        ctx.restore()

        p.x += p.vx
        p.y += p.vy
        p.rot += p.rotV
        p.vy += 0.07
        p.vx *= 0.99

        // Respawn from top once off-screen (continuous for 5s)
        if (p.y > H + 20) Object.assign(particles[idx], makeParticle(W))
      })
    }

    const interval = setInterval(draw, 16)
    const dismissTimer = setTimeout(onDismiss, 5000)
    return () => { clearInterval(interval); clearTimeout(dismissTimer) }
  }, [onDismiss])

  return (
    <canvas
      ref={canvasRef}
      onClick={onDismiss}
      style={{ position: 'fixed', inset: 0, zIndex: 9995, pointerEvents: 'all', cursor: 'pointer', display: 'block' }}
    />
  )
}
