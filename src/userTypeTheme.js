const THEMES = {
  private: {
    color: '#378ADD',
    colorLight: '#E6F1FB',
    colorDark: '#0C447C',
    borderWidth: '1.5px',
    avatarBg: '#BDD8F7',
    avatarText: '#0C447C',
    avatarRadius: '50%',
    badgeBg: '#C8E2F9',
    badgeText: '#0C447C',
  },
  network: {
    color: '#1D9E75',
    colorLight: '#E1F5EE',
    colorDark: '#085041',
    borderWidth: '3px',
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

export default THEMES
