// Canonical implementation lives in src/i18n/LanguageContext.jsx (wired up in main.jsx).
// This shim lets new code import from src/context/ without changing existing imports.
export { LanguageProvider, useLanguage } from '../i18n/LanguageContext.jsx'
