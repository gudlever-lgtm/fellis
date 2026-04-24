const THEMES = {
  private: {
    color: '#2D6A4F',
    colorLight: '#E8F5EE',
    colorDark: '#1B4332',
    borderWidth: '1.5px',
    leftBorderColor: '#2D6A4F',
    avatarBg: '#B7DDD0',
    avatarText: '#1B4332',
    avatarRadius: '50%',
    badgeBg: '#D1ECE3',
    badgeText: '#1B4332',
  },
  network: {
    color: '#1D9E75',
    colorLight: '#E1F5EE',
    colorDark: '#085041',
    borderWidth: '3px',
    leftBorderColor: '#1D9E75',
    avatarBg: '#A7E6CC',
    avatarText: '#085041',
    avatarRadius: '50%',
    badgeBg: '#C3EDD8',
    badgeText: '#085041',
  },
  business: {
    color: '#BA7517',
    colorLight: '#FAEEDA',
    colorDark: '#633806',
    borderWidth: '3px',
    leftBorderColor: '#E03131',
    avatarBg: '#F5D598',
    avatarText: '#633806',
    avatarRadius: '6px',
    badgeBg: '#F0D198',
    badgeText: '#633806',
  },
}

export function getTheme(authorMode) {
  if (authorMode === 'network') return THEMES.network
  if (authorMode === 'business') return THEMES.business
  return THEMES.private
}

export const CONTEXT_TO_THEME = {
  social: 'private',
  professional: 'network',
  business: 'business',
}

export default THEMES
