export function detectLanguage() {
  const supported = ['da', 'en'];

  const saved = localStorage.getItem('lang');
  if (saved && supported.includes(saved)) return saved;

  const browser = navigator.language?.split('-')[0];
  if (browser && supported.includes(browser)) return browser;

  return 'en';
}
