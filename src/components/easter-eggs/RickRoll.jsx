/**
 * RickRoll — small YouTube embed in the corner playing Never Gonna Give You Up.
 * Dismiss by clicking ✕.
 */
export default function RickRoll({ onDismiss }) {
  return (
    <div
      style={{
        position: 'fixed', bottom: 50, right: 20, zIndex: 9980,
        background: '#000', borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        width: 288, height: 180,
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute', top: 6, right: 8,
          background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
          fontSize: 16, cursor: 'pointer', zIndex: 1, lineHeight: 1,
          borderRadius: 4, padding: '2px 6px',
        }}
      >✕</button>
      <iframe
        src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=0"
        allow="autoplay; encrypted-media"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        title="Never Gonna Give You Up"
      />
    </div>
  )
}
