const LOCALE_MAP = {
  da: 'da-DK',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  fi: 'fi-FI',
  it: 'it-IT',
  nl: 'nl-NL',
  sv: 'sv-SE',
  no: 'nb-NO',
  pl: 'pl-PL',
  pt: 'pt-PT',
}

export function getLocale(lang) {
  return LOCALE_MAP[lang] ?? 'en-GB'
}
