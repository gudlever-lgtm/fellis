import { useState } from 'react'
import FeedbackModal from './FeedbackModal.jsx'

export default function FeedbackButton({ t }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t.feedbackMenu || 'Feedback'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 800,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          borderRadius: 28,
          border: 'none',
          background: '#2D6A4F',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
          fontFamily: 'inherit',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.28)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.22)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {t.feedbackMenu || 'Feedback'}
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} t={t} />
    </>
  )
}
