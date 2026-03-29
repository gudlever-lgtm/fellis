export default function BusinessBadge({ lang, size = 'sm' }) {
  const label = lang === 'da' ? 'Virksomhed' : 'Business'
  const s = {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: size === 'xs' ? 9 : 10,
    fontWeight: 700,
    padding: size === 'xs' ? '1px 5px' : '2px 8px',
    borderRadius: 8,
    background: '#EEF2FF',
    color: '#4338CA',
    border: '1px solid #C7D2FE',
    letterSpacing: '0.03em',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
  }
  return <span style={s}>{label}</span>
}
