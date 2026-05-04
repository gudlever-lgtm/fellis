export default function SkeletonCard() {
  return (
    <div className="feed-card" style={{ background: 'white', border: '0.5px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div className="skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
        <div style={{ flex: 1 }}>
          <div className="skel" style={{ width: '40%', height: 12, borderRadius: 4, marginBottom: 6 }} />
          <div className="skel" style={{ width: '25%', height: 10, borderRadius: 4 }} />
        </div>
      </div>
      <div className="skel" style={{ width: '100%', height: 12, borderRadius: 4, marginBottom: 8 }} />
      <div className="skel" style={{ width: '85%', height: 12, borderRadius: 4, marginBottom: 8 }} />
      <div className="skel" style={{ width: '60%', height: 12, borderRadius: 4 }} />
    </div>
  )
}
