import { useState } from 'react'
import { apiVotePoll } from '../api.js'
import { PT } from '../data.js'

export default function PollWidget({ poll, lang, onVoted }) {
  const [voting, setVoting] = useState(false)

  if (!poll) return null

  const totalVotes = poll.options.reduce((sum, o) => sum + (o.vote_count || 0), 0)
  const ended = poll.ends_at && new Date(poll.ends_at) < new Date()
  const hasVoted = poll.user_vote != null

  const handleVote = async (optionId) => {
    if (hasVoted || ended || voting) return
    setVoting(true)
    await apiVotePoll(poll.id, optionId)
    onVoted?.()
    setVoting(false)
  }

  const pct = (count) => totalVotes === 0 ? 0 : Math.round((count / totalVotes) * 100)

  return (
    <div style={{ marginTop: 12, borderRadius: 12, border: '1px solid var(--border,#e5e7eb)', padding: '12px 14px', background: 'var(--card,#fff)' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        {ended
          ? (PT[lang].pollEnded)
          : hasVoted
            ? (PT[lang].youVoted)
            : (PT[lang].vote)}
        {poll.ends_at && !ended && (
          <span style={{ marginLeft: 6 }}>
            · {PT[lang].ends} {new Date(poll.ends_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US')}
          </span>
        )}
      </div>
      {poll.options.map(opt => {
        const p = pct(opt.vote_count || 0)
        const isUserChoice = poll.user_vote === opt.id
        return (
          <div
            key={opt.id}
            onClick={() => handleVote(opt.id)}
            style={{
              marginBottom: 8,
              borderRadius: 8,
              border: `2px solid ${isUserChoice ? '#1877F2' : 'var(--border,#e5e7eb)'}`,
              overflow: 'hidden',
              cursor: hasVoted || ended ? 'default' : 'pointer',
              position: 'relative',
              background: 'var(--bg,#f9fafb)',
            }}
          >
            {(hasVoted || ended) && (
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%', width: `${p}%`,
                background: isUserChoice ? 'rgba(24,119,242,0.15)' : 'rgba(0,0,0,0.06)',
                transition: 'width 0.4s ease',
              }} />
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
              <span style={{ fontSize: 14, fontWeight: isUserChoice ? 700 : 400 }}>
                {lang === 'da' ? (opt.text_da || opt.text_en) : (opt.text_en || opt.text_da)}
                {isUserChoice && <span style={{ marginLeft: 6 }}>✓</span>}
              </span>
              {(hasVoted || ended) && (
                <span style={{ fontSize: 13, fontWeight: 700, color: isUserChoice ? '#1877F2' : '#555' }}>{p}%</span>
              )}
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
        {totalVotes} {totalVotes === 1 ? PT[lang].vote : PT[lang].votes}
      </div>
    </div>
  )
}
