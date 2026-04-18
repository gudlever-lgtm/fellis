// src/i18n/index.js — centralised translation registry
import da from './da.js'
import en from './en.js'
import de from './de.js'
import es from './es.js'
import fr from './fr.js'
import it from './it.js'
import nl from './nl.js'
import no from './no.js'
import pl from './pl.js'
import pt from './pt.js'
import sv from './sv.js'

export const PT = { da, en, de, es, fr, it, nl, no, pl, pt, sv }

export function getTranslations(lang) {
  if (lang === 'da') return PT.da
  if (lang === 'en') return PT.en
  const specific = PT[lang]
  if (!specific) return PT.en
  return { ...PT.en, ...specific }
}
