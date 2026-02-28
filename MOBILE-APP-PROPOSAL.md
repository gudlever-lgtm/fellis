# fellis.eu — Mobilapp-oplæg (Android & iOS)

## Oversigt

Dette dokument beskriver strategi, arkitektur og implementeringsplan for at gøre
fellis.eu tilgængelig som installerbar mobilapp på **Android** og **iOS**.

Den anbefalede tilgang er en **to-trins strategi**:

1. **Fase 1 — PWA (Progressive Web App)**: Hurtig gevinst, ingen app store
2. **Fase 2 — Capacitor**: Native app-wrapper til Google Play og Apple App Store

---

## Fase 1: Progressive Web App (PWA)

### Hvad er en PWA?

En PWA gør det muligt for brugere at "installere" fellis.eu direkte fra browseren
— helt uden app stores. Appen får sit eget ikon på hjemmeskærmen, åbner i
fuldskærm (uden browser-chrome), og kan fungere offline for cachede sider.

### Hvad kræver det?

| Komponent | Beskrivelse | Status |
|-----------|-------------|--------|
| `manifest.json` | App-metadata: navn, ikoner, farver, display-mode | Ny fil |
| Service Worker | Cache-strategi, offline-support, push-notifikationer | Ny fil |
| HTTPS | Krypteret forbindelse (krav for PWA) | Allerede opsat |
| App-ikoner | PNG-ikoner i 192x192 og 512x512 | Skal laves |
| Meta-tags | `<meta name="theme-color">`, Apple-specifikke tags | Tilføjes i index.html |

### Fordele

- **Ingen app store-godkendelse** — øjeblikkelig distribution
- **Automatiske opdateringer** — brugere får altid nyeste version
- **Én kodebase** — ingen ekstra vedligeholdelse
- **Android**: Fuld "Add to Home Screen"-prompt med native app-oplevelse
- **iOS (Safari)**: "Føj til hjemmeskærm" med standalone-tilstand

### Begrænsninger

- iOS: Push-notifikationer kræver iOS 16.4+ og brugerens eksplicitte tilladelse
- iOS: Ingen baggrundssync
- Ingen synlighed i App Store (brugere skal kende URL'en)

### Implementation

#### 1. Web App Manifest (`src/public/manifest.json`)

```json
{
  "name": "fellis.eu – Et bedre socialt medie",
  "short_name": "fellis",
  "description": "Flyt til et bedre socialt medie",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAFAF7",
  "theme_color": "#2D6A4F",
  "orientation": "portrait-primary",
  "lang": "da",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

#### 2. Service Worker (`src/public/sw.js`)

```js
const CACHE_NAME = 'fellis-v1'
const STATIC_ASSETS = [
  '/',
  '/assets/app.js',
  '/assets/index.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
]

// Cache statiske assets ved installation
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
  )
})

// Network-first strategi for API, cache-first for statiske filer
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) {
    // API-kald: altid netværk, fallback til cache
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    )
  } else {
    // Statiske filer: cache først, netværk som fallback
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    )
  }
})
```

#### 3. Meta-tags i `index.html`

```html
<!-- PWA -->
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#2D6A4F" />

<!-- iOS-specifik -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="fellis" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

#### 4. Registrering af Service Worker i `main.jsx`

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
```

### Estimeret omfang — Fase 1

- Manifest + Service Worker + meta-tags
- Generering af app-ikoner (baseret på fellis-logo)
- Test på Android Chrome + iOS Safari

---

## Fase 2: Capacitor (Native App-Wrapper)

### Hvad er Capacitor?

Capacitor (fra Ionic-teamet) indpakker en eksisterende webapplikation i en native
Android/iOS-container. Det giver:

- Adgang til native API'er (kamera, push-notifikationer, filsystem, biometri)
- Distribution via **Google Play Store** og **Apple App Store**
- Samme kodebase som web-versionen

### Arkitektur

```
┌─────────────────────────────────────────────┐
│                 fellis.eu                    │
│              (React + Vite)                  │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Feed    │  │ Messages │  │  Profile   │  │
│  │  Page    │  │  Page    │  │  Page      │  │
│  └─────────┘  └──────────┘  └────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│           Capacitor Bridge                   │
├──────────┬──────────┬────────────────────────┤
│  Push    │  Camera  │  Secure Storage        │
│  Notif.  │  Access  │  (sessions/tokens)     │
├──────────┴──────────┴────────────────────────┤
│        Native Shell (Android / iOS)          │
│     WebView (Chrome / WKWebView)             │
└──────────────────────────────────────────────┘
```

### Krav

| Ressource | Android | iOS |
|-----------|---------|-----|
| Developer-konto | Google Play Console — $25 (engangsbeløb) | Apple Developer Program — $99/år |
| IDE | Android Studio | Xcode (kræver macOS) |
| Minimum OS | Android 6.0 (API 23) | iOS 14+ |
| Byg-maskine | Windows/Mac/Linux | Kun macOS |

### Implementation

#### 1. Installer Capacitor

```bash
npm install @capacitor/core @capacitor/cli
npx cap init fellis eu.fellis.app --web-dir=dist
```

#### 2. Capacitor-konfiguration (`capacitor.config.ts`)

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'eu.fellis.app',
  appName: 'fellis',
  webDir: 'dist',
  server: {
    // I udvikling: peg på lokal dev-server
    // url: 'http://192.168.1.X:5173',

    // I produktion: brug bundled web-assets
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#2D6A4F',
      showSpinner: false
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#2D6A4F'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
}

export default config
```

#### 3. Tilføj platforme

```bash
npx cap add android
npx cap add ios
```

Dette genererer:
- `android/` — Komplet Android Studio-projekt
- `ios/` — Komplet Xcode-projekt

#### 4. Byg og sync

```bash
# Byg web-assets
npm run build

# Kopiér til native projekter
npx cap sync

# Åbn i IDE
npx cap open android   # Android Studio
npx cap open ios       # Xcode
```

#### 5. Anbefalede Capacitor-plugins

| Plugin | Formål |
|--------|--------|
| `@capacitor/push-notifications` | Native push-notifikationer for nye beskeder |
| `@capacitor/camera` | Direkte kameraadgang til opslag/avatar |
| `@capacitor/share` | Del opslag via native share-dialog |
| `@capacitor/haptics` | Haptisk feedback ved likes/interaktioner |
| `@capacitor/secure-storage` | Krypteret session-lagring (erstatter localStorage) |
| `@capacitor/app` | Deep links, app-tilstand (forgrund/baggrund) |
| `@capacitor/splash-screen` | Branded splash-screen ved opstart |
| `@capacitor/status-bar` | Tilpas statusbar-farve til fellis-tema |

### Nødvendige tilpasninger i eksisterende kode

#### A. API Base URL

I `src/api.js` skal API-URL'en pege på den rigtige server:

```js
// Web: relativ URL (f.eks. /api/feed)
// Mobil: absolut URL (f.eks. https://fellis.eu/api/feed)
const BASE_URL = import.meta.env.VITE_API_URL
  || (window.Capacitor ? 'https://fellis.eu' : '')
```

#### B. Session-lagring

Erstat `localStorage` med Capacitor Secure Storage på mobil:

```js
import { Preferences } from '@capacitor/preferences'

// Universelt: fungerer på web OG native
export async function setSession(key, value) {
  await Preferences.set({ key, value })
}

export async function getSession(key) {
  const { value } = await Preferences.get({ key })
  return value
}
```

#### C. Facebook OAuth på mobil

Native apps kan ikke bruge server-redirect-flow direkte.
Løsning: Brug Capacitors `Browser`-plugin eller `@capacitor-community/facebook-login`:

```js
import { Browser } from '@capacitor/browser'

// Åbn Facebook OAuth i in-app browser
async function loginWithFacebook(lang) {
  await Browser.open({
    url: `https://fellis.eu/api/auth/facebook?lang=${lang}`
  })
}

// Lyt efter deep link callback
App.addListener('appUrlOpen', ({ url }) => {
  if (url.includes('fb_session=')) {
    const sessionId = new URL(url).searchParams.get('fb_session')
    // Gem session og naviger til platform
  }
})
```

#### D. Deep Links

Tilføj URL-scheme for OAuth-callback:

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="fellis" android:host="auth" />
  <data android:scheme="https" android:host="fellis.eu" />
</intent-filter>
```

**iOS** (`ios/App/App/Info.plist`):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>fellis</string>
    </array>
  </dict>
</array>
```

---

## Distributionsmuligheder

### Oversigt

| Metode | Android | iOS | Godkendelse | Automatiske opdateringer |
|--------|---------|-----|-------------|-------------------------|
| **PWA** | Ja (Chrome) | Delvist (Safari) | Nej | Ja (instant) |
| **Google Play / App Store** | Ja | Ja | Ja (review) | Via store-opdatering |
| **Android APK (sideload)** | Ja | — | Nej | Manuel |
| **TestFlight** | — | Ja (beta) | Minimal | Ja (inden for beta) |
| **Capacitor Live Update** | Ja | Ja | Nej (web-lag) | Ja (instant) |

### Android: Direkte distribution (uden Google Play)

Det **er muligt** at distribuere en Android-app direkte fra serveren:

1. Byg en signed APK/AAB i Android Studio
2. Host `.apk`-filen på `https://fellis.eu/download/fellis.apk`
3. Brugere downloader og installerer (skal aktivere "Ukendte kilder")

**Ulempe**: Google Play Protect kan advare brugere. Ingen automatiske opdateringer.

### iOS: App Store er påkrævet

Apple tillader **ikke** sideloading for offentlige apps. Muligheder:

- **App Store**: Standard distribution ($99/år)
- **TestFlight**: Op til 10.000 beta-testere (gratis, kræver Apple Developer-konto)
- **Enterprise**: Kun til interne firma-apps ($299/år), ikke til offentlig distribution

### Anbefaling

For fellis.eu anbefales:

1. **Start med PWA** (Fase 1) — giver 80% af mobiloplevelsen med 20% af indsatsen
2. **Tilføj Capacitor** (Fase 2) når der er behov for:
   - Push-notifikationer (nye beskeder, likes, kommentarer)
   - App Store-synlighed og troværdighed
   - Native kameraintegration
   - Bedre Facebook OAuth-flow på mobil

---

## Tidsplan

### Fase 1: PWA (anbefalet start)

| Opgave | Beskrivelse |
|--------|-------------|
| Manifest + ikoner | `manifest.json`, app-ikoner i flere størrelser |
| Service Worker | Cache-strategi, offline-fallback |
| Meta-tags | iOS- og Android-specifikke head-tags |
| Viewport-optimering | Sikre at alle sider fungerer perfekt på mobil |
| Test | Android Chrome, iOS Safari, Lighthouse PWA-audit |

### Fase 2: Capacitor

| Opgave | Beskrivelse |
|--------|-------------|
| Opsætning | Capacitor init, tilføj Android + iOS platforme |
| Build-pipeline | Vite build → Capacitor sync → native build |
| Plugin-integration | Push, kamera, secure storage, splash screen |
| OAuth-tilpasning | Deep links, in-app browser for Facebook-login |
| API-tilpasning | Absolut URL, Capacitor-detection |
| Store-assets | Screenshots, beskrivelser, app-ikoner (DA+EN) |
| Android build | Signed APK/AAB, Google Play upload |
| iOS build | Xcode archive, TestFlight → App Store upload |

---

## Konklusion

fellis.eu er **idéelt egnet** til mobilapp-konvertering fordi:

- React-frontend er allerede responsiv
- API'et er rent REST (fungerer fra enhver klient)
- Billeduploads bruger standard multipart/form-data
- Session-baseret auth er nemt at tilpasse

**PWA giver den hurtigste vej til en installerbar mobilapp.
Capacitor giver den komplette native oplevelse med App Store-distribution.**
