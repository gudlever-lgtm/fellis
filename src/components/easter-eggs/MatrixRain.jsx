import { useEffect, useRef } from 'react'

const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * MatrixRain — full-screen green falling characters.
 * Auto-dismisses after 5 seconds or on click.
 */
export default function MatrixRain({ onDismiss }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = W
    canvas.height = H

    const fontSize = 14
    const cols = Math.floor(W / fontSize)
    const drops = Array(cols).fill(1)
    let frame = 0

    const draw = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#00FF41'
      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)]
        // Brightest at the front of the drop
        if (i % 3 === frame % 3) {
          ctx.fillStyle = '#ffffff'
          ctx.fillText(char, i * fontSize, drops[i] * fontSize)
          ctx.fillStyle = '#00FF41'
        } else {
          ctx.fillText(char, i * fontSize, drops[i] * fontSize)
        }
        if (drops[i] * fontSize > H && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
      frame++
    }

    const interval = setInterval(draw, 33)
    const dismissTimer = setTimeout(onDismiss, 5000)
    return () => { clearInterval(interval); clearTimeout(dismissTimer) }
  }, [onDismiss])

  return (
    <canvas
      ref={canvasRef}
      onClick={onDismiss}
      style={{ position: 'fixed', inset: 0, zIndex: 9990, cursor: 'pointer', display: 'block' }}
    />
  )
}
