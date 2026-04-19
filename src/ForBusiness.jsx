import { useState, useEffect } from 'react'
import { UI_LANGS, PT } from './data.js'
import { useTranslation } from './i18n/useTranslation.js'
import { apiGetPublicPricing } from './api.js'
import { formatPrice } from './utils/currency.js'

export default function ForBusiness() {
  const { lang, setLanguage } = useTranslation('common')
  const t = PT[lang] || PT.en
  const da = lang === 'da'
  const [pricing, setPricing] = useState(null)

  useEffect(() => {
    apiGetPublicPricing().then(data => { if (data) setPricing(data) })
  }, [])

  const isLoggedIn = localStorage.getItem('fellis_logged_in') === 'true'
  const ctaHref = isLoggedIn ? '/?page=settings' : '/register'

  const s = {
    page: {
      fontFamily: "'DM Sans', sans-serif",
      color: '#2D3436',
      background: '#FAFAF9',
      minHeight: '100vh',
    },
    nav: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 32px',
      background: '#fff',
      borderBottom: '1px solid #E8E4DF',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    },
    brand: {
      fontFamily: "'Playfair Display', serif",
      fontSize: 22,
      fontWeight: 700,
      color: '#2D6A4F',
      textDecoration: 'none',
    },
    navRight: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    },
    langBtn: {
      background: 'none',
      border: '1px solid #ccc',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 13,
    },
    ctaBtn: {
      background: '#2D6A4F',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '10px 20px',
      fontSize: 14,
      fontWeight: 600,
      cursor: 'pointer',
      textDecoration: 'none',
      display: 'inline-block',
    },
    ctaBtnLg: {
      background: '#2D6A4F',
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '14px 32px',
      fontSize: 16,
      fontWeight: 700,
      cursor: 'pointer',
      textDecoration: 'none',
      display: 'inline-block',
    },

    // Hero
    hero: {
      maxWidth: 760,
      margin: '0 auto',
      padding: '72px 24px 64px',
      textAlign: 'center',
    },
    heroTitle: {
      fontFamily: "'Playfair Display', serif",
      fontSize: 42,
      fontWeight: 700,
      color: '#2D3436',
      marginBottom: 20,
      lineHeight: 1.2,
    },
    heroSubtext: {
      fontSize: 18,
      color: '#555',
      lineHeight: 1.7,
      maxWidth: 580,
      margin: '0 auto 36px',
    },

    // Sections
    section: {
      maxWidth: 900,
      margin: '0 auto',
      padding: '56px 24px',
    },
    sectionAlt: {
      background: '#fff',
      borderTop: '1px solid #E8E4DF',
      borderBottom: '1px solid #E8E4DF',
    },
    sectionTitle: {
      fontSize: 28,
      fontWeight: 700,
      color: '#2D3436',
      marginBottom: 40,
      textAlign: 'center',
    },

    // How it works — 3 step cards
    stepsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 24,
    },
    stepCard: {
      background: '#fff',
      border: '1px solid #E8E4DF',
      borderRadius: 14,
      padding: '28px 24px',
    },
    stepNumber: {
      width: 36,
      height: 36,
      borderRadius: '50%',
      background: '#2D6A4F',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 16,
      marginBottom: 14,
    },
    stepTitle: {
      fontSize: 16,
      fontWeight: 700,
      color: '#2D3436',
      marginBottom: 8,
    },
    stepDesc: {
      fontSize: 14,
      color: '#666',
      lineHeight: 1.6,
    },

    // Features list
    featureList: {
      listStyle: 'none',
      padding: 0,
      margin: '0 auto',
      maxWidth: 560,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    },
    featureItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      fontSize: 15,
      color: '#444',
      lineHeight: 1.5,
    },
    featureCheck: {
      width: 22,
      height: 22,
      borderRadius: '50%',
      background: '#2D6A4F',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      fontWeight: 700,
      flexShrink: 0,
      marginTop: 1,
    },

    // Pricing
    pricingCard: {
      background: '#fff',
      border: '2px solid #2D6A4F',
      borderRadius: 16,
      padding: '36px 40px',
      maxWidth: 420,
      margin: '0 auto',
      textAlign: 'center',
    },
    pricingPlan: {
      fontSize: 14,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: '#2D6A4F',
      marginBottom: 12,
    },
    pricingPrice: {
      fontSize: 36,
      fontWeight: 700,
      color: '#2D3436',
      marginBottom: 8,
    },
    pricingNote: {
      fontSize: 13,
      color: '#888',
      marginBottom: 28,
      lineHeight: 1.5,
    },

    // Footer CTA
    footerCta: {
      background: '#2D6A4F',
      padding: '64px 24px',
      textAlign: 'center',
    },
    footerCtaTitle: {
      fontSize: 28,
      fontWeight: 700,
      color: '#fff',
      marginBottom: 28,
    },
    ctaBtnWhite: {
      background: '#fff',
      color: '#2D6A4F',
      border: 'none',
      borderRadius: 10,
      padding: '14px 32px',
      fontSize: 16,
      fontWeight: 700,
      cursor: 'pointer',
      textDecoration: 'none',
      display: 'inline-block',
    },

    footer: {
      textAlign: 'center',
      fontSize: 13,
      color: '#999',
      padding: '24px 16px',
      background: '#fff',
      borderTop: '1px solid #E8E4DF',
    },
  }

  const howSteps = [
    { title: t.forBusinessHowStep1Title, desc: t.forBusinessHowStep1Desc },
    { title: t.forBusinessHowStep2Title, desc: t.forBusinessHowStep2Desc },
    { title: t.forBusinessHowStep3Title, desc: t.forBusinessHowStep3Desc },
  ]

  const features = [
    t.forBusinessFeature1,
    t.forBusinessFeature2,
    t.forBusinessFeature3,
    t.forBusinessFeature4,
    t.forBusinessFeature5,
  ]

  return (
    <div style={s.page}>
      {/* Navigation */}
      <nav style={s.nav}>
        <a href="/" style={s.brand}>fellis.eu</a>
        <div style={s.navRight}>
          <select
            className="lang-toggle"
            value={lang}
            onChange={e => setLanguage(e.target.value)}
            aria-label="Language"
          >
            {UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <a href={ctaHref} style={s.ctaBtn}>{t.forBusinessHeroCta}</a>
        </div>
      </nav>

      {/* Hero */}
      <div style={s.hero}>
        <h1 style={s.heroTitle}>{t.forBusinessHeroTitle}</h1>
        <p style={s.heroSubtext}>{t.forBusinessHeroSubtext}</p>
        <a href={ctaHref} style={s.ctaBtnLg}>{t.forBusinessHeroCta}</a>
      </div>

      {/* How it works */}
      <div style={s.sectionAlt}>
        <div style={s.section}>
          <h2 style={s.sectionTitle}>{t.forBusinessHowTitle}</h2>
          <div style={s.stepsGrid}>
            {howSteps.map((step, i) => (
              <div key={i} style={s.stepCard}>
                <div style={s.stepNumber}>{i + 1}</div>
                <div style={s.stepTitle}>{step.title}</div>
                <p style={s.stepDesc}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* What you get */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>{t.forBusinessWhatTitle}</h2>
        <ul style={s.featureList}>
          {features.map((feature, i) => (
            <li key={i} style={s.featureItem}>
              <span style={s.featureCheck}>✓</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Pricing */}
      <div style={s.sectionAlt}>
        <div style={s.section}>
          <h2 style={s.sectionTitle}>{t.forBusinessPricingTitle}</h2>

          {/* Free tier */}
          <div style={s.pricingCard}>
            <div style={s.pricingPlan}>{t.forBusinessPricingPlan}</div>
            <div style={s.pricingPrice}>{t.forBusinessPricingFree}</div>
            <p style={s.pricingNote}>{t.forBusinessPricingFreeNote}</p>
            <a href={ctaHref} style={s.ctaBtnLg}>{t.forBusinessHeroCta}</a>
          </div>

          {/* Paid extras */}
          <div style={{ maxWidth: 420, margin: '28px auto 0' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#aaa', textAlign: 'center', marginBottom: 14 }}>
              {t.forBusinessPricingPaidTitle}
            </div>
            {[
              { label: t.forBusinessPricingAds,     desc: t.forBusinessPricingAdsDesc,    price: pricing ? formatPrice(pricing.ad_price_cpm) : null },
              { label: t.forBusinessPricingBoost,   desc: t.forBusinessPricingBoostDesc,  price: pricing ? formatPrice(pricing.boost_price) : null },
              { label: t.forBusinessPricingAdfree,  desc: t.forBusinessPricingAdfreeDesc, price: pricing ? formatPrice(pricing.adfree_price_private) : null },
            ].map((item, i, arr) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#fff', border: '1px solid #E8E4DF', borderRadius: i === 0 ? '10px 10px 0 0' : i === arr.length - 1 ? '0 0 10px 10px' : 0, borderTop: i > 0 ? 'none' : undefined }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#2D3436' }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{item.desc}</div>
                </div>
                <div style={{ fontSize: 13, color: item.price ? '#2D6A4F' : '#aaa', fontStyle: item.price ? 'normal' : 'italic', fontWeight: item.price ? 600 : 400, flexShrink: 0, marginLeft: 12 }}>
                  {item.price ?? (da ? 'variabel' : 'variable')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div style={s.footerCta}>
        <h2 style={s.footerCtaTitle}>{t.forBusinessFooterTitle}</h2>
        <a href={ctaHref} style={s.ctaBtnWhite}>{t.forBusinessFooterCta}</a>
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <p>fellis.eu — {da ? 'Dansk social platform hostet i EU' : 'Danish social platform hosted in the EU'}</p>
        <a href="/" style={{ color: '#2D6A4F', textDecoration: 'none' }}>{da ? '← Gå til fellis.eu' : '← Go to fellis.eu'}</a>
      </div>
    </div>
  )
}
