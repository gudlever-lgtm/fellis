import { useState } from 'react'
import { apiDismissOnboarding } from './api.js'
import { getTranslations } from './data.js'

export default function OnboardingChecklist({ lang, currentUser, onNavigate, onDismiss }) {
  const t = getTranslations(lang)
  const [dismissing, setDismissing] = useState(false)

  const hasAvatar = Boolean(currentUser?.avatar_url)
  const hasBio = Boolean(currentUser?.bio_da || currentUser?.bio_en || currentUser?.bio)
  const hasPosted = Boolean(currentUser?.post_count > 0)
  const hasGroup = Boolean(currentUser?.group_count > 0)
  const hasFollowing = Boolean(currentUser?.following_count > 0)

  const steps = [
    {
      title: t.onboardingStep1Title,
      desc: t.onboardingStep1Desc,
      done: hasAvatar && hasBio,
      action: () => onNavigate('edit-profile'),
    },
    {
      title: t.onboardingStep2Title,
      desc: t.onboardingStep2Desc,
      done: hasPosted,
      action: () => onNavigate('feed'),
    },
    {
      title: t.onboardingStep3Title,
      desc: t.onboardingStep3Desc,
      done: hasGroup,
      action: () => onNavigate('explore'),
    },
    {
      title: t.onboardingStep4Title,
      desc: t.onboardingStep4Desc,
      done: hasFollowing,
      action: () => onNavigate('friends'),
    },
  ]

  const doneCount = steps.filter(s => s.done).length

  const handleDismiss = async () => {
    setDismissing(true)
    await apiDismissOnboarding().catch(() => {})
    onDismiss()
  }

  const s = {
    card: {
      background: '#fff',
      border: '1px solid #E8E4DF',
      borderRadius: 14,
      padding: '20px 24px',
      marginBottom: 20,
      fontFamily: "'DM Sans', sans-serif",
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 4,
    },
    title: {
      fontSize: 17,
      fontWeight: 700,
      color: '#2D3436',
      margin: 0,
    },
    subtitle: {
      fontSize: 13,
      color: '#888',
      marginBottom: 16,
    },
    progress: {
      fontSize: 13,
      color: '#2D6A4F',
      fontWeight: 600,
    },
    progressBar: {
      height: 4,
      background: '#E8E4DF',
      borderRadius: 2,
      marginBottom: 18,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      background: '#2D6A4F',
      borderRadius: 2,
      width: `${(doneCount / steps.length) * 100}%`,
      transition: 'width 0.4s ease',
    },
    steps: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
    step: (done) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 10,
      background: done ? '#F0FAF4' : '#FAFAF9',
      border: `1px solid ${done ? '#C3E6CB' : '#E8E4DF'}`,
      cursor: done ? 'default' : 'pointer',
      transition: 'background 0.15s',
    }),
    check: (done) => ({
      width: 22,
      height: 22,
      borderRadius: '50%',
      border: `2px solid ${done ? '#2D6A4F' : '#ccc'}`,
      background: done ? '#2D6A4F' : '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      fontSize: 12,
      color: '#fff',
    }),
    stepText: {
      flex: 1,
      minWidth: 0,
    },
    stepTitle: (done) => ({
      fontSize: 14,
      fontWeight: 600,
      color: done ? '#2D6A4F' : '#2D3436',
      marginBottom: 1,
      textDecoration: done ? 'line-through' : 'none',
    }),
    stepDesc: {
      fontSize: 12,
      color: '#888',
    },
    arrow: {
      fontSize: 16,
      color: '#aaa',
      flexShrink: 0,
    },
    dismissBtn: {
      marginTop: 16,
      background: 'none',
      border: 'none',
      color: '#888',
      fontSize: 13,
      cursor: 'pointer',
      padding: 0,
      textDecoration: 'underline',
    },
  }

  return (
    <div style={s.card}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>{t.onboardingTitle}</h2>
        </div>
        <span style={s.progress}>{doneCount} {t.onboardingProgress} {steps.length} {t.onboardingDone}</span>
      </div>
      <p style={s.subtitle}>{t.onboardingSubtitle}</p>

      <div style={s.progressBar}>
        <div style={s.progressFill} />
      </div>

      <div style={s.steps}>
        {steps.map((step, i) => (
          <div
            key={i}
            style={s.step(step.done)}
            onClick={step.done ? undefined : step.action}
            role={step.done ? undefined : 'button'}
            tabIndex={step.done ? undefined : 0}
            onKeyDown={step.done ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') step.action() }}
          >
            <div style={s.check(step.done)}>
              {step.done && '✓'}
            </div>
            <div style={s.stepText}>
              <div style={s.stepTitle(step.done)}>{step.title}</div>
              <div style={s.stepDesc}>{step.desc}</div>
            </div>
            {!step.done && <span style={s.arrow}>›</span>}
          </div>
        ))}
      </div>

      <button style={s.dismissBtn} onClick={handleDismiss} disabled={dismissing}>
        {t.onboardingDismiss}
      </button>
    </div>
  )
}
