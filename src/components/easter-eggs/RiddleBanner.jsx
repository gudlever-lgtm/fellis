import { useState, useEffect } from 'react'

const RIDDLES = [
  {
    q_da: 'Hvad har hænder men ingen arme, og et ansigt men ingen øjne?',
    a_da: 'Et ur.',
    q_en: 'What has hands but no arms, and a face but no eyes?',
    a_en: 'A clock.',
  },
  {
    q_da: 'Jo mere du tager af mig, jo større bliver jeg. Hvad er jeg?',
    a_da: 'Et hul.',
    q_en: 'The more you take from me, the bigger I grow. What am I?',
    a_en: 'A hole.',
  },
  {
    q_da: 'Jeg har byer, men ingen huse. Jeg har bjerge, men ingen træer. Jeg har vand, men ingen fisk. Hvad er jeg?',
    a_da: 'Et kort.',
    q_en: 'I have cities but no houses. I have mountains but no trees. I have water but no fish. What am I?',
    a_en: 'A map.',
  },
  {
    q_da: 'Hvad kan løbe men ikke gå, have en munding men ikke tale, og have en bred men ingen arme?',
    a_da: 'En flod.',
    q_en: 'What can run but never walks, has a mouth but never talks, has a bed but never sleeps?',
    a_en: 'A river.',
  },
  {
    q_da: 'Hvad er let som en fjer, men selv den stærkeste mand kan ikke holde det i mere end et par minutter?',
    a_da: 'Vejret.',
    q_en: 'Light as a feather, yet the strongest man cannot hold it for more than a few minutes. What am I?',
    a_en: 'Breath.',
  },
  {
    q_da: 'Hvad går op men aldrig kommer ned?',
    a_da: 'Din alder.',
    q_en: 'What goes up but never comes down?',
    a_en: 'Your age.',
  },
  {
    q_da: 'Jeg taler uden mund og hører uden øren. Jeg eksisterer ikke, men fortæller alt. Hvad er jeg?',
    a_da: 'Et ekko.',
    q_en: 'I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?',
    a_en: 'An echo.',
  },
  {
    q_da: 'Hvad begynder med E, slutter med E, men indeholder kun ét bogstav?',
    a_da: 'En konvolut.',
    q_en: 'What starts with E, ends with E, but contains only one letter?',
    a_en: 'An envelope.',
  },
]

/**
 * RiddleBanner — overlays the bottom with a riddle.
 * First click reveals the answer; second click dismisses.
 * Triggered by Shift+Click on the ? hint icon.
 */
export default function RiddleBanner({ lang = 'da', onDismiss }) {
  const [riddle] = useState(() => RIDDLES[Math.floor(Math.random() * RIDDLES.length)])
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  const handleClick = () => {
    if (!revealed) { setRevealed(true) } else { onDismiss() }
  }

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)',
        borderTop: '2px solid #9D4EDD',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', minHeight: 44, cursor: 'pointer',
        boxShadow: '0 -2px 12px rgba(157,78,221,0.2)',
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>❓</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#9D4EDD', flexShrink: 0, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {PT[lang].riddle}
      </span>
      <span style={{ color: '#333', fontSize: 12, fontWeight: 500, flex: 1 }}>
        {lang === 'da' ? riddle.q_da : riddle.q_en}
        {revealed && (
          <span style={{ color: '#9D4EDD', marginLeft: 8, fontWeight: 700 }}>
            → {lang === 'da' ? riddle.a_da : riddle.a_en}
          </span>
        )}
      </span>
      <span style={{ fontSize: 13, color: '#bbb', flexShrink: 0 }}>
        {revealed ? '✕ Esc' : (PT[lang].clickForAnswer)}
      </span>
    </div>
  )
}
