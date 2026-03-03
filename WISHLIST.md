# Fellis.eu — Ønskeliste / Wishlist

Idéer og features til fremtidige releases.

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
