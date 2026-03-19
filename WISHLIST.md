# Fellis.eu — Ønskeliste / Wishlist

Idéer og features til fremtidige releases.

---

## Kode & Arkitektur

### Oversættelser i separate sprogfiler
Flytte `PT`-objektet i `src/data.js` fra ét stort inline-objekt til separate JSON-filer:

```
src/locales/
  da.json
  en.json
```

Importeres i `data.js` som:
```js
import da from './locales/da.json'
import en from './locales/en.json'
export const PT = { da, en }
```

Ingen ændringer i komponenter — kun flytning af indhold.

**Fordele:** Nemmere for eksterne oversættere · Understøtter tooling (Weblate, POEditor m.fl.) · Gør det trivielt at tilføje et tredje sprog.

**Hvornår:** Relevant hvis et tredje sprog ønskes, eller en ekstern oversætter involveres.

---

## Integrationer

### Google Photos (eller lignende)
Mulighed for at importere billeder direkte fra Google Photos, iCloud Photos el.lign. til opslag og profil.

**Kræver:**
- Google OAuth 2.0 + Google Photos API (`https://photospicker.googleapis.com`)
- Alternativt: brug Google Picker API (viser et in-browser galleri uden fuld OAuth)
- Backend: midlertidig download af valgt billede → gem via eksisterende upload-pipeline (Multer)
- GDPR-note: brugeren skal eksplicit give tilladelse; ingen tokens gemmes permanent

**Varianter der kan overvejes:**
- Google Photos
- iCloud (meget begrænset offentlig API — svær)
- Dropbox / OneDrive (nemmere OAuth-flows)
