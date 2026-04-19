import { useState, useCallback, useEffect, useRef } from 'react'
import { UI_LANGS, PT } from './data.js'
import { apiLogin, apiRegister, apiForgotPassword, apiResetPassword, apiVerifyMfa, apiGiveConsent } from './api.js'
import { useTranslation } from './i18n/useTranslation.js'
import daT from './i18n/landing/da.json'
import enT from './i18n/landing/en.json'

// ── Landing translations ──
const T = {
  da: daT,
  en: enT,
  de: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Anmelden',
    headline: 'Verlagere dein soziales Leben nach Europa',
    subtitle: 'fellis.eu — die neue europäische Plattform für dich, nicht für Werbetreibende.',
    cta: 'Loslegen',
    createCardTitle: 'Neues Konto erstellen',
    createCardDesc: 'Starte neu auf fellis.eu mit E-Mail und Passwort.',
    createCardBtn: 'Konto erstellen',
    manifestoLine1: 'Soziale Medien haben dich an Werbetreibende verkauft.',
    manifestoLine2: 'Das fanden wir keinen fairen Deal.',
    manifestoLine3: 'Fellis ist eine europäische Community-Plattform — dein Feed ist chronologisch, immer. Werbung ist klar gekennzeichnet. Deine Daten bleiben deine.',
    manifestoWhys: [
      { icon: '📅', text: 'Chronologischer Feed — kein Algorithmus entscheidet, was du siehst.' },
      { icon: '🇪🇺', text: 'Deine Daten bleiben in Europa, geschützt durch die DSGVO.' },
      { icon: '🎯', text: 'Werbung nach Kontext — nicht nach deinem persönlichen Profil.' },
      { icon: '🤝', text: 'Du bist der Nutzer — nicht das Produkt.' },
    ],
    trustEncrypt: 'Ende-zu-Ende-verschlüsselt',
    trustEU: 'In der EU gehostet',
    trustDelete: 'Volle Kontrolle über deine Daten',
    servicesLabel: 'Aufgebaut auf europäischen Diensten',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Zahlungen', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'KI (Lebenslauf / Anschreiben)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Lade deine Freunde ein',
    inviteSubtitle: 'Hilf deinen Freunden, zu fellis.eu zu wechseln',
    selectAll: 'Alle auswählen',
    deselectAll: 'Alle abwählen',
    mutualFriends: 'gemeinsame Freunde',
    skip: 'Überspringen',
    sendInvites: 'Einladungen senden',
    sendingInvites: 'Einladungen werden gesendet...',
    inviteLinkTitle: 'Teile deinen Einladungslink',
    inviteLinkDesc: 'Teile diesen Link mit deinen Freunden, damit ihr euch automatisch auf fellis.eu verbindet',
    copyLink: 'Link kopieren',
    linkCopied: 'Kopiert!',
    invitedBy: 'lädt dich zu fellis.eu ein',
    doneTitle: 'Willkommen bei fellis.eu!',
    doneSubtitle: 'Dein Konto ist bereit. Dein neues digitales Zuhause wartet.',
    viewProfile: 'Dein Profil anzeigen',
    back: 'Zurück',
    loginTitle: 'Bei fellis.eu anmelden',
    loginEmail: 'E-Mail',
    loginPassword: 'Passwort',
    loginSubmit: 'Anmelden',
    loginCancel: 'Abbrechen',
    loginError: 'Ungültige E-Mail oder falsches Passwort',
    loginErrorSocialOnly: 'Dieses Konto wurde über Google oder LinkedIn erstellt. Bitte verwende die entsprechende Anmelde-Schaltfläche.',
    loginErrorRateLimit: 'Zu viele Anmeldeversuche — bitte versuche es in 15 Minuten erneut.',
    loginErrorUnavailable: 'Anmeldedienst vorübergehend nicht verfügbar — bitte versuche es in Kürze erneut.',
    loginNoAccount: 'Noch kein Konto?',
    loginSignup: 'Loslegen',
    forgotPassword: 'Passwort vergessen?',
    forgotTitle: 'Passwort zurücksetzen',
    forgotEmail: 'Deine E-Mail',
    forgotSubmit: 'Reset-Link senden',
    forgotSent: 'Reset-Link gesendet!',
    forgotSetNew: 'Neues Passwort festlegen',
    forgotNewPassword: 'Neues Passwort (min. 6 Zeichen)',
    forgotConfirm: 'Passwort speichern',
    forgotSuccess: 'Passwort aktualisiert! Du bist jetzt angemeldet.',
    forgotError: 'Passwort konnte nicht zurückgesetzt werden',
    forgotRateLimit: 'Zu viele Versuche — bitte versuche es in Kürze erneut',
    forgotEmailFailed: 'Der Reset-Link konnte nicht gesendet werden — überprüfe die E-Mail-Adresse oder versuche es erneut',
    forgotBack: 'Zurück zur Anmeldung',
    forgotEmailSent: 'Schaue in deiner E-Mail nach einem Reset-Link.',
    forgotFbNote: 'Dein Konto ist über Google oder LinkedIn verbunden. Du kannst unten ein lokales Passwort festlegen.',
    mfaTitle: 'Zwei-Faktor-Authentifizierung',
    mfaDesc: 'Wir haben einen 6-stelligen Code an deine Telefonnummer gesendet.',
    mfaDescEmail: 'Wir haben einen 6-stelligen Code an deine E-Mail gesendet.',
    mfaCode: 'Einmalcode',
    mfaSubmit: 'Bestätigen',
    mfaError: 'Ungültiger oder abgelaufener Code',
    mfaBack: 'Zurück zur Anmeldung',
    registerTitle: 'Erstelle dein fellis.eu-Konto',
    registerName: 'Vollständiger Name',
    registerEmail: 'E-Mail',
    registerEmailRepeat: 'E-Mail wiederholen',
    registerEmailMismatch: 'E-Mail-Adressen stimmen nicht überein',
    registerPassword: 'Passwort wählen (min. 6 Zeichen)',
    registerPasswordRepeat: 'Passwort wiederholen',
    registerPasswordMismatch: 'Passwörter stimmen nicht überein',
    registerMathChallenge: 'Was ist {a} + {b}?',
    registerMathError: 'Falsche Antwort — bitte versuche es erneut',
    registerSubmit: 'Konto erstellen & zum Profil',
    registerError: 'Konto konnte nicht erstellt werden',
    registerErrorDuplicate: 'Diese E-Mail wird bereits verwendet — melde dich an oder verwende eine andere E-Mail',
    registerErrorRateLimit: 'Zu viele Versuche — bitte versuche es in Kürze erneut',
    registerGdpr: 'Ich stimme der Verarbeitung meiner personenbezogenen Daten gemäß der',
    registerGdprLink: 'Datenschutzerklärung von fellis.eu',
    registerGdprRequired: 'Du musst die Datenschutzerklärung akzeptieren, um ein Konto zu erstellen',
    modeStepTitle: 'Wähle deinen Kontotyp',
    modeStepSubtitle: 'Du kannst dies jederzeit in deinen Profileinstellungen ändern.',
    modeCommon: 'Privat',
    modeBusiness: 'Geschäftlich',
    modeCommonDesc: 'Für persönlichen Gebrauch, Familie und Community. Freunde, Beiträge und Veranstaltungen.',
    modeBusinessDesc: 'Für professionelles Networking und Unternehmensauftritt. Verbindungen, Branchenveranstaltungen und Unternehmensseiten.',
    modeCommonFeatures: ['Freunde & Community', 'Familienfreundliche Einstellungen', 'Persönliche Veranstaltungen'],
    modeBusinessFeatures: ['Professionelle Verbindungen', 'Unternehmensseiten', 'Konferenzen & Webinare'],
    modeSelectBtn: 'Loslegen',
  },
  fr: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Se connecter',
    headline: 'Déplacez votre vie sociale vers l\'Europe',
    subtitle: 'fellis.eu — la nouvelle plateforme européenne conçue pour vous, pas pour les annonceurs.',
    cta: 'Commencer',
    createCardTitle: 'Créer un nouveau compte',
    createCardDesc: 'Repartez de zéro sur fellis.eu avec un e-mail et un mot de passe.',
    createCardBtn: 'Créer un compte',
    manifestoLine1: 'Les réseaux sociaux vous ont vendu aux annonceurs.',
    manifestoLine2: 'Nous ne pensions pas que c\'était un accord équitable.',
    manifestoLine3: 'Fellis est une plateforme communautaire européenne — votre fil est chronologique, toujours. Les publicités sont clairement étiquetées. Vos données restent les vôtres.',
    manifestoWhys: [
      { icon: '📅', text: 'Fil chronologique — aucun algorithme ne décide ce que vous voyez.' },
      { icon: '🇪🇺', text: 'Vos données restent en Europe, protégées par le RGPD.' },
      { icon: '🎯', text: 'Les publicités sont affichées par contexte, pas selon votre profil.' },
      { icon: '🤝', text: 'Vous êtes l\'utilisateur — pas le produit.' },
    ],
    trustEncrypt: 'Chiffrement de bout en bout',
    trustEU: 'Hébergé dans l\'UE',
    trustDelete: 'Contrôle total sur vos données',
    servicesLabel: 'Construit sur des services européens',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hébergement', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Paiements', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'IA (CV / lettre de motivation)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Invitez vos amis',
    inviteSubtitle: 'Aidez vos amis à passer à fellis.eu',
    selectAll: 'Tout sélectionner',
    deselectAll: 'Tout désélectionner',
    mutualFriends: 'amis en commun',
    skip: 'Ignorer',
    sendInvites: 'Envoyer les invitations',
    sendingInvites: 'Envoi des invitations...',
    inviteLinkTitle: 'Partagez votre lien d\'invitation',
    inviteLinkDesc: 'Partagez ce lien avec vos amis pour vous connecter automatiquement sur fellis.eu',
    copyLink: 'Copier le lien',
    linkCopied: 'Copié !',
    invitedBy: 'vous invite sur fellis.eu',
    doneTitle: 'Bienvenue sur fellis.eu !',
    doneSubtitle: 'Votre compte est prêt. Votre nouveau foyer numérique vous attend.',
    viewProfile: 'Voir votre profil',
    back: 'Retour',
    loginTitle: 'Se connecter à fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Mot de passe',
    loginSubmit: 'Se connecter',
    loginCancel: 'Annuler',
    loginError: 'E-mail ou mot de passe invalide',
    loginErrorSocialOnly: 'Ce compte a été créé via Google ou LinkedIn. Veuillez utiliser le bouton de connexion correspondant.',
    loginErrorRateLimit: 'Trop de tentatives de connexion — veuillez réessayer dans 15 minutes.',
    loginErrorUnavailable: 'Service de connexion temporairement indisponible — veuillez réessayer dans un moment.',
    loginNoAccount: 'Pas encore de compte ?',
    loginSignup: 'Commencer',
    forgotPassword: 'Mot de passe oublié ?',
    forgotTitle: 'Réinitialiser le mot de passe',
    forgotEmail: 'Votre e-mail',
    forgotSubmit: 'Envoyer le lien de réinitialisation',
    forgotSent: 'Lien de réinitialisation envoyé !',
    forgotSetNew: 'Définir un nouveau mot de passe',
    forgotNewPassword: 'Nouveau mot de passe (min. 6 caractères)',
    forgotConfirm: 'Enregistrer le mot de passe',
    forgotSuccess: 'Mot de passe mis à jour ! Vous êtes maintenant connecté.',
    forgotError: 'Impossible de réinitialiser le mot de passe',
    forgotRateLimit: 'Trop de tentatives — veuillez réessayer dans un moment',
    forgotEmailFailed: 'Le lien de réinitialisation n\'a pas pu être envoyé — vérifiez l\'adresse e-mail ou réessayez',
    forgotBack: 'Retour à la connexion',
    forgotEmailSent: 'Vérifiez votre e-mail pour un lien de réinitialisation.',
    forgotFbNote: 'Votre compte est connecté via Google ou LinkedIn. Vous pouvez définir un mot de passe local ci-dessous.',
    mfaTitle: 'Authentification à deux facteurs',
    mfaDesc: 'Nous avons envoyé un code à 6 chiffres à votre numéro de téléphone.',
    mfaDescEmail: 'Nous avons envoyé un code à 6 chiffres à votre e-mail.',
    mfaCode: 'Code à usage unique',
    mfaSubmit: 'Vérifier',
    mfaError: 'Code invalide ou expiré',
    mfaBack: 'Retour à la connexion',
    registerTitle: 'Créez votre compte fellis.eu',
    registerName: 'Nom complet',
    registerEmail: 'E-mail',
    registerEmailRepeat: 'Répéter l\'e-mail',
    registerEmailMismatch: 'Les adresses e-mail ne correspondent pas',
    registerPassword: 'Choisissez un mot de passe (min. 6 caractères)',
    registerPasswordRepeat: 'Répéter le mot de passe',
    registerPasswordMismatch: 'Les mots de passe ne correspondent pas',
    registerMathChallenge: 'Combien font {a} + {b} ?',
    registerMathError: 'Mauvaise réponse — veuillez réessayer',
    registerSubmit: 'Créer un compte & aller au profil',
    registerError: 'Impossible de créer un compte',
    registerErrorDuplicate: 'Cet e-mail est déjà utilisé — connectez-vous ou utilisez un autre e-mail',
    registerErrorRateLimit: 'Trop de tentatives — veuillez réessayer dans un moment',
    registerGdpr: 'J\'accepte le traitement de mes données personnelles conformément à la',
    registerGdprLink: 'politique de confidentialité de fellis.eu',
    registerGdprRequired: 'Vous devez accepter la politique de confidentialité pour créer un compte',
    modeStepTitle: 'Choisissez le type de compte',
    modeStepSubtitle: 'Vous pouvez toujours modifier cela dans vos paramètres de profil.',
    modeCommon: 'Personnel',
    modeBusiness: 'Professionnel',
    modeCommonDesc: 'Pour un usage personnel, la famille et la communauté. Amis, publications et événements.',
    modeBusinessDesc: 'Pour le réseautage professionnel et la présence d\'entreprise. Connexions, événements sectoriels et pages d\'entreprise.',
    modeCommonFeatures: ['Amis & communauté', 'Paramètres adaptés aux familles', 'Événements personnels'],
    modeBusinessFeatures: ['Connexions professionnelles', 'Pages d\'entreprise', 'Conférences & webinaires'],
    modeSelectBtn: 'Commencer',
  },
  nl: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Inloggen',
    headline: 'Verplaats uw sociale leven naar Europa',
    subtitle: 'fellis.eu — het nieuwe Europese platform gebouwd voor u, niet voor adverteerders.',
    cta: 'Beginnen',
    createCardTitle: 'Nieuw account aanmaken',
    createCardDesc: 'Begin opnieuw op fellis.eu met e-mail en wachtwoord.',
    createCardBtn: 'Account aanmaken',
    manifestoLine1: 'Sociale media hebben u verkocht aan adverteerders.',
    manifestoLine2: 'Wij vonden dat geen eerlijke deal.',
    manifestoLine3: 'Fellis is een Europees communityplatform — uw feed is chronologisch, altijd. Advertenties zijn duidelijk gemarkeerd. Uw gegevens blijven van u.',
    manifestoWhys: [
      { icon: '📅', text: 'Chronologische feed — geen algoritme dat bepaalt wat u ziet.' },
      { icon: '🇪🇺', text: 'Uw gegevens blijven in Europa, beschermd door de AVG.' },
      { icon: '🎯', text: 'Advertenties op basis van context, niet uw persoonlijk profiel.' },
      { icon: '🤝', text: 'U bent de gebruiker — niet het product.' },
    ],
    trustEncrypt: 'End-to-end versleuteld',
    trustEU: 'In de EU gehost',
    trustDelete: 'Volledige controle over uw gegevens',
    servicesLabel: 'Gebouwd op Europese diensten',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Betalingen', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (cv / sollicitatiebrief)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Nodig uw vrienden uit',
    inviteSubtitle: 'Help uw vrienden over te stappen naar fellis.eu',
    selectAll: 'Alles selecteren',
    deselectAll: 'Alles deselecteren',
    mutualFriends: 'gemeenschappelijke vrienden',
    skip: 'Overslaan',
    sendInvites: 'Uitnodigingen verzenden',
    sendingInvites: 'Uitnodigingen verzenden...',
    inviteLinkTitle: 'Deel uw uitnodigingslink',
    inviteLinkDesc: 'Deel deze link met uw vrienden zodat u automatisch verbinding maakt op fellis.eu',
    copyLink: 'Link kopiëren',
    linkCopied: 'Gekopieerd!',
    invitedBy: 'nodigt u uit op fellis.eu',
    doneTitle: 'Welkom bij fellis.eu!',
    doneSubtitle: 'Uw account is klaar. Uw nieuwe digitale thuis wacht.',
    viewProfile: 'Uw profiel bekijken',
    back: 'Terug',
    loginTitle: 'Inloggen op fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Wachtwoord',
    loginSubmit: 'Inloggen',
    loginCancel: 'Annuleren',
    loginError: 'Ongeldig e-mailadres of wachtwoord',
    loginErrorSocialOnly: 'Dit account is aangemaakt via Google of LinkedIn. Gebruik de bijbehorende inlogknop.',
    loginErrorRateLimit: 'Te veel inlogpogingen — probeer het over 15 minuten opnieuw.',
    loginErrorUnavailable: 'Inlogservice tijdelijk niet beschikbaar — probeer het binnenkort opnieuw.',
    loginNoAccount: 'Nog geen account?',
    loginSignup: 'Beginnen',
    forgotPassword: 'Wachtwoord vergeten?',
    forgotTitle: 'Wachtwoord opnieuw instellen',
    forgotEmail: 'Uw e-mail',
    forgotSubmit: 'Resetlink verzenden',
    forgotSent: 'Resetlink verzonden!',
    forgotSetNew: 'Nieuw wachtwoord instellen',
    forgotNewPassword: 'Nieuw wachtwoord (min. 6 tekens)',
    forgotConfirm: 'Wachtwoord opslaan',
    forgotSuccess: 'Wachtwoord bijgewerkt! U bent nu ingelogd.',
    forgotError: 'Wachtwoord kon niet worden gereset',
    forgotRateLimit: 'Te veel pogingen — probeer het binnenkort opnieuw',
    forgotEmailFailed: 'De resetlink kon niet worden verzonden — controleer het e-mailadres of probeer het opnieuw',
    forgotBack: 'Terug naar inloggen',
    forgotEmailSent: 'Controleer uw e-mail voor een resetlink.',
    forgotFbNote: 'Uw account is verbonden via Google of LinkedIn. U kunt hieronder een lokaal wachtwoord instellen.',
    mfaTitle: 'Tweestapsverificatie',
    mfaDesc: 'We hebben een 6-cijferige code naar uw telefoonnummer gestuurd.',
    mfaDescEmail: 'We hebben een 6-cijferige code naar uw e-mail gestuurd.',
    mfaCode: 'Eenmalige code',
    mfaSubmit: 'Verifiëren',
    mfaError: 'Ongeldige of verlopen code',
    mfaBack: 'Terug naar inloggen',
    registerTitle: 'Maak uw fellis.eu-account aan',
    registerName: 'Volledige naam',
    registerEmail: 'E-mail',
    registerEmailRepeat: 'E-mail herhalen',
    registerEmailMismatch: 'E-mailadressen komen niet overeen',
    registerPassword: 'Kies een wachtwoord (min. 6 tekens)',
    registerPasswordRepeat: 'Wachtwoord herhalen',
    registerPasswordMismatch: 'Wachtwoorden komen niet overeen',
    registerMathChallenge: 'Wat is {a} + {b}?',
    registerMathError: 'Fout antwoord — probeer het opnieuw',
    registerSubmit: 'Account aanmaken & naar profiel',
    registerError: 'Account kon niet worden aangemaakt',
    registerErrorDuplicate: 'Dit e-mailadres is al in gebruik — log in of gebruik een ander e-mailadres',
    registerErrorRateLimit: 'Te veel pogingen — probeer het binnenkort opnieuw',
    registerGdpr: 'Ik accepteer de verwerking van mijn persoonsgegevens overeenkomstig het',
    registerGdprLink: 'privacybeleid van fellis.eu',
    registerGdprRequired: 'U moet het privacybeleid accepteren om een account aan te maken',
    modeStepTitle: 'Kies uw accounttype',
    modeStepSubtitle: 'U kunt dit altijd wijzigen in uw profielinstellingen.',
    modeCommon: 'Persoonlijk',
    modeBusiness: 'Zakelijk',
    modeCommonDesc: 'Voor persoonlijk gebruik, familie en community. Vrienden, berichten en evenementen.',
    modeBusinessDesc: 'Voor professioneel netwerken en bedrijfsaanwezigheid. Verbindingen, branche-evenementen en bedrijfspagina\'s.',
    modeCommonFeatures: ['Vrienden & community', 'Gezinsvriendelijke instellingen', 'Persoonlijke evenementen'],
    modeBusinessFeatures: ['Professionele verbindingen', 'Bedrijfspagina\'s', 'Conferenties & webinars'],
    modeSelectBtn: 'Beginnen',
  },
  sv: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Logga in',
    headline: 'Flytta ditt sociala liv till Europa',
    subtitle: 'fellis.eu — den nya europeiska plattformen byggd för dig, inte för annonsörer.',
    cta: 'Kom igång',
    createCardTitle: 'Skapa nytt konto',
    createCardDesc: 'Börja om på fellis.eu med e-post och lösenord.',
    createCardBtn: 'Skapa konto',
    manifestoLine1: 'Sociala medier sålde dig till annonsörerna.',
    manifestoLine2: 'Vi tyckte inte det var ett rättvist avtal.',
    manifestoLine3: 'Fellis är en europeisk communityplattform — ditt flöde är kronologiskt, alltid. Annonser är tydligt märkta. Dina uppgifter förblir dina.',
    manifestoWhys: [
      { icon: '📅', text: 'Kronologiskt flöde — ingen algoritm bestämmer vad du ser.' },
      { icon: '🇪🇺', text: 'Dina uppgifter stannar i Europa, skyddade av GDPR.' },
      { icon: '🎯', text: 'Annonser visas efter kontext, inte din personliga profil.' },
      { icon: '🤝', text: 'Du är användaren — inte produkten.' },
    ],
    trustEncrypt: 'End-to-end-krypterat',
    trustEU: 'Hostat i EU',
    trustDelete: 'Full kontroll över dina uppgifter',
    servicesLabel: 'Byggt på europeiska tjänster',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Betalningar', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (CV / personligt brev)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Bjud in dina vänner',
    inviteSubtitle: 'Hjälp dina vänner att byta till fellis.eu',
    selectAll: 'Välj alla',
    deselectAll: 'Avmarkera alla',
    mutualFriends: 'gemensamma vänner',
    skip: 'Hoppa över',
    sendInvites: 'Skicka inbjudningar',
    sendingInvites: 'Skickar inbjudningar...',
    inviteLinkTitle: 'Dela din inbjudningslänk',
    inviteLinkDesc: 'Dela den här länken med dina vänner så att ni automatiskt kopplas samman på fellis.eu',
    copyLink: 'Kopiera länk',
    linkCopied: 'Kopierad!',
    invitedBy: 'bjuder in dig till fellis.eu',
    doneTitle: 'Välkommen till fellis.eu!',
    doneSubtitle: 'Ditt konto är redo. Ditt nya digitala hem väntar.',
    viewProfile: 'Visa din profil',
    back: 'Tillbaka',
    loginTitle: 'Logga in på fellis.eu',
    loginEmail: 'E-post',
    loginPassword: 'Lösenord',
    loginSubmit: 'Logga in',
    loginCancel: 'Avbryt',
    loginError: 'Ogiltig e-post eller lösenord',
    loginErrorSocialOnly: 'Det här kontot skapades via Google eller LinkedIn. Använd motsvarande inloggningsknapp.',
    loginErrorRateLimit: 'För många inloggningsförsök — försök igen om 15 minuter.',
    loginErrorUnavailable: 'Inloggningstjänsten är tillfälligt otillgänglig — försök igen inom kort.',
    loginNoAccount: 'Har du inget konto?',
    loginSignup: 'Kom igång',
    forgotPassword: 'Glömt lösenord?',
    forgotTitle: 'Återställ lösenord',
    forgotEmail: 'Din e-post',
    forgotSubmit: 'Skicka återställningslänk',
    forgotSent: 'Återställningslänk skickad!',
    forgotSetNew: 'Ange nytt lösenord',
    forgotNewPassword: 'Nytt lösenord (min. 6 tecken)',
    forgotConfirm: 'Spara lösenord',
    forgotSuccess: 'Lösenordet uppdaterades! Du är nu inloggad.',
    forgotError: 'Det gick inte att återställa lösenordet',
    forgotRateLimit: 'För många försök — försök igen inom kort',
    forgotEmailFailed: 'Återställningslänken kunde inte skickas — kontrollera e-postadressen eller försök igen',
    forgotBack: 'Tillbaka till inloggning',
    forgotEmailSent: 'Kontrollera din e-post för en återställningslänk.',
    forgotFbNote: 'Ditt konto är anslutet via Google eller LinkedIn. Du kan ange ett lokalt lösenord nedan.',
    mfaTitle: 'Tvåfaktorsautentisering',
    mfaDesc: 'Vi skickade en 6-siffrig kod till ditt telefonnummer.',
    mfaDescEmail: 'Vi skickade en 6-siffrig kod till din e-post.',
    mfaCode: 'Engångskod',
    mfaSubmit: 'Verifiera',
    mfaError: 'Ogiltig eller utgången kod',
    mfaBack: 'Tillbaka till inloggning',
    registerTitle: 'Skapa ditt fellis.eu-konto',
    registerName: 'Fullständigt namn',
    registerEmail: 'E-post',
    registerEmailRepeat: 'Upprepa e-post',
    registerEmailMismatch: 'E-postadresserna stämmer inte överens',
    registerPassword: 'Välj ett lösenord (min. 6 tecken)',
    registerPasswordRepeat: 'Upprepa lösenord',
    registerPasswordMismatch: 'Lösenorden stämmer inte överens',
    registerMathChallenge: 'Vad är {a} + {b}?',
    registerMathError: 'Fel svar — försök igen',
    registerSubmit: 'Skapa konto & gå till profil',
    registerError: 'Det gick inte att skapa konto',
    registerErrorDuplicate: 'Den här e-posten används redan — logga in eller använd en annan e-post',
    registerErrorRateLimit: 'För många försök — försök igen inom kort',
    registerGdpr: 'Jag accepterar behandlingen av mina personuppgifter i enlighet med fellis.eu:s',
    registerGdprLink: 'integritetspolicy',
    registerGdprRequired: 'Du måste acceptera integritetspolicyn för att skapa ett konto',
    modeStepTitle: 'Välj din kontotyp',
    modeStepSubtitle: 'Du kan alltid ändra detta i dina profilinställningar.',
    modeCommon: 'Privat',
    modeBusiness: 'Företag',
    modeCommonDesc: 'För personligt bruk, familj och community. Vänner, inlägg och evenemang.',
    modeBusinessDesc: 'För professionellt nätverkande och företagsnärvaro. Kontakter, branschevenemang och företagssidor.',
    modeCommonFeatures: ['Vänner & community', 'Familjevänliga inställningar', 'Personliga evenemang'],
    modeBusinessFeatures: ['Professionella kontakter', 'Företagssidor', 'Konferenser & webbseminarier'],
    modeSelectBtn: 'Kom igång',
  },
  fi: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Kirjaudu sisään',
    headline: 'Siirrä sosiaalinen elämäsi Eurooppaan',
    subtitle: 'fellis.eu — uusi eurooppalainen alusta rakennettu sinulle, ei mainostajille.',
    cta: 'Aloita',
    createCardTitle: 'Luo uusi tili',
    createCardDesc: 'Aloita alusta fellis.eu:ssa sähköpostilla ja salasanalla.',
    createCardBtn: 'Luo tili',
    manifestoLine1: 'Sosiaalinen media myi sinut mainostajille.',
    manifestoLine2: 'Emme pitäneet sitä reiluna kauppana.',
    manifestoLine3: 'Fellis on eurooppalainen yhteisöalusta — syötteesi on kronologinen, aina. Mainokset on selkeästi merkitty. Tietosi pysyvät sinun.',
    manifestoWhys: [
      { icon: '📅', text: 'Kronologinen syöte — mikään algoritmi ei päätä, mitä näet.' },
      { icon: '🇪🇺', text: 'Tietosi pysyvät Euroopassa, suojattuina GDPR:llä.' },
      { icon: '🎯', text: 'Mainokset näytetään kontekstin perusteella, ei henkilökohtaisen profiilisi perusteella.' },
      { icon: '🤝', text: 'Olet käyttäjä — et tuote.' },
    ],
    trustEncrypt: 'Päästä päähän -salattu',
    trustEU: 'Isännöity EU:ssa',
    trustDelete: 'Täysi hallinta tiedoistasi',
    servicesLabel: 'Rakennettu eurooppalaisten palvelujen varaan',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Maksut', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (ansioluettelo / saatekirje)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Kutsu ystäväsi',
    inviteSubtitle: 'Auta ystäviäsi siirtymään fellis.eu:hun',
    selectAll: 'Valitse kaikki',
    deselectAll: 'Poista kaikkien valinta',
    mutualFriends: 'yhteistä ystävää',
    skip: 'Ohita',
    sendInvites: 'Lähetä kutsut',
    sendingInvites: 'Lähetetään kutsuja...',
    inviteLinkTitle: 'Jaa kutsulinkki',
    inviteLinkDesc: 'Jaa tämä linkki ystävillesi, jotta teistä tulee automaattisesti yhdistettyjä fellis.eu:ssa',
    copyLink: 'Kopioi linkki',
    linkCopied: 'Kopioitu!',
    invitedBy: 'kutsuu sinut fellis.eu:hun',
    doneTitle: 'Tervetuloa fellis.eu:hun!',
    doneSubtitle: 'Tilisi on valmis. Uusi digitaalinen kotisi odottaa.',
    viewProfile: 'Näytä profiilisi',
    back: 'Takaisin',
    loginTitle: 'Kirjaudu fellis.eu:hun',
    loginEmail: 'Sähköposti',
    loginPassword: 'Salasana',
    loginSubmit: 'Kirjaudu sisään',
    loginCancel: 'Peruuta',
    loginError: 'Virheellinen sähköposti tai salasana',
    loginErrorSocialOnly: 'Tämä tili luotiin Googlen tai LinkedInin kautta. Käytä vastaavaa kirjautumispainiketta.',
    loginErrorRateLimit: 'Liian monta kirjautumisyritystä — yritä uudelleen 15 minuutin kuluttua.',
    loginErrorUnavailable: 'Kirjautumispalvelu on tilapäisesti poissa käytöstä — yritä uudelleen hetken kuluttua.',
    loginNoAccount: 'Ei vielä tiliä?',
    loginSignup: 'Aloita',
    forgotPassword: 'Unohditko salasanan?',
    forgotTitle: 'Nollaa salasana',
    forgotEmail: 'Sähköpostisi',
    forgotSubmit: 'Lähetä nollauslinkki',
    forgotSent: 'Nollauslinkki lähetetty!',
    forgotSetNew: 'Aseta uusi salasana',
    forgotNewPassword: 'Uusi salasana (vähintään 6 merkkiä)',
    forgotConfirm: 'Tallenna salasana',
    forgotSuccess: 'Salasana päivitetty! Olet nyt kirjautunut sisään.',
    forgotError: 'Salasanaa ei voitu nollata',
    forgotRateLimit: 'Liian monta yritystä — yritä uudelleen hetken kuluttua',
    forgotEmailFailed: 'Nollauslinkkiä ei voitu lähettää — tarkista sähköpostiosoite tai yritä uudelleen',
    forgotBack: 'Takaisin kirjautumiseen',
    forgotEmailSent: 'Tarkista sähköpostisi nollauslinkistä.',
    forgotFbNote: 'Tilisi on yhdistetty Googlen tai LinkedInin kautta. Voit asettaa paikallisen salasanan alla.',
    mfaTitle: 'Kaksivaiheinen tunnistautuminen',
    mfaDesc: 'Lähetimme 6-numeroisen koodin puhelinnumeroosi.',
    mfaDescEmail: 'Lähetimme 6-numeroisen koodin sähköpostiisi.',
    mfaCode: 'Kertakäyttöinen koodi',
    mfaSubmit: 'Vahvista',
    mfaError: 'Virheellinen tai vanhentunut koodi',
    mfaBack: 'Takaisin kirjautumiseen',
    registerTitle: 'Luo fellis.eu-tilisi',
    registerName: 'Koko nimi',
    registerEmail: 'Sähköposti',
    registerEmailRepeat: 'Toista sähköposti',
    registerEmailMismatch: 'Sähköpostiosoitteet eivät täsmää',
    registerPassword: 'Valitse salasana (vähintään 6 merkkiä)',
    registerPasswordRepeat: 'Toista salasana',
    registerPasswordMismatch: 'Salasanat eivät täsmää',
    registerMathChallenge: 'Mitä on {a} + {b}?',
    registerMathError: 'Väärä vastaus — yritä uudelleen',
    registerSubmit: 'Luo tili ja siirry profiiliin',
    registerError: 'Tilin luominen epäonnistui',
    registerErrorDuplicate: 'Tämä sähköposti on jo käytössä — kirjaudu sisään tai käytä toista sähköpostia',
    registerErrorRateLimit: 'Liian monta yritystä — yritä uudelleen hetken kuluttua',
    registerGdpr: 'Hyväksyn henkilötietojeni käsittelyn fellis.eu:n',
    registerGdprLink: 'tietosuojakäytännön mukaisesti',
    registerGdprRequired: 'Sinun on hyväksyttävä tietosuojakäytäntö tilin luomiseksi',
    modeStepTitle: 'Valitse tilityyppisi',
    modeStepSubtitle: 'Voit muuttaa tätä milloin tahansa profiiliasetuksissasi.',
    modeCommon: 'Henkilökohtainen',
    modeBusiness: 'Yritys',
    modeCommonDesc: 'Henkilökohtaiseen käyttöön, perheelle ja yhteisölle. Ystävät, julkaisut ja tapahtumat.',
    modeBusinessDesc: 'Ammatilliseen verkostoitumiseen ja yritysläsnäoloon. Yhteydet, alan tapahtumat ja yrityssivut.',
    modeCommonFeatures: ['Ystävät & yhteisö', 'Perheystävälliset asetukset', 'Henkilökohtaiset tapahtumat'],
    modeBusinessFeatures: ['Ammatilliset yhteydet', 'Yrityssivut', 'Konferenssit & webinaaret'],
    modeSelectBtn: 'Aloita',
  },
  no: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Logg inn',
    headline: 'Flytt ditt sosiale liv til Europa',
    subtitle: 'fellis.eu — den nye europeiske plattformen bygget for deg, ikke for annonsører.',
    cta: 'Kom i gang',
    createCardTitle: 'Opprett ny konto',
    createCardDesc: 'Start på nytt på fellis.eu med e-post og passord.',
    createCardBtn: 'Opprett konto',
    manifestoLine1: 'Sosiale medier solgte deg til annonsørene.',
    manifestoLine2: 'Vi syntes ikke det var en rettferdig handel.',
    manifestoLine3: 'Fellis er en europeisk fellesskapsplattform — feeden din er kronologisk, alltid. Annonser er tydelig merket. Dataene dine forblir dine.',
    manifestoWhys: [
      { icon: '📅', text: 'Kronologisk feed — ingen algoritme bestemmer hva du ser.' },
      { icon: '🇪🇺', text: 'Dataene dine forblir i Europa, beskyttet av GDPR.' },
      { icon: '🎯', text: 'Annonser vises basert på kontekst, ikke din personlige profil.' },
      { icon: '🤝', text: 'Du er brukeren — ikke produktet.' },
    ],
    trustEncrypt: 'Ende-til-ende-kryptert',
    trustEU: 'Hostet i EU',
    trustDelete: 'Full kontroll over dataene dine',
    servicesLabel: 'Bygget på europeiske tjenester',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Betalinger', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'KI (CV / søknadsbrev)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Inviter vennene dine',
    inviteSubtitle: 'Hjelp vennene dine med å bytte til fellis.eu',
    selectAll: 'Velg alle',
    deselectAll: 'Fjern alle valg',
    mutualFriends: 'felles venner',
    skip: 'Hopp over',
    sendInvites: 'Send invitasjoner',
    sendingInvites: 'Sender invitasjoner...',
    inviteLinkTitle: 'Del invitasjonslenken din',
    inviteLinkDesc: 'Del denne lenken med vennene dine, så kobles dere automatisk på fellis.eu',
    copyLink: 'Kopier lenke',
    linkCopied: 'Kopiert!',
    invitedBy: 'inviterer deg til fellis.eu',
    doneTitle: 'Velkommen til fellis.eu!',
    doneSubtitle: 'Kontoen din er klar. Ditt nye digitale hjem venter.',
    viewProfile: 'Se profilen din',
    back: 'Tilbake',
    loginTitle: 'Logg inn på fellis.eu',
    loginEmail: 'E-post',
    loginPassword: 'Passord',
    loginSubmit: 'Logg inn',
    loginCancel: 'Avbryt',
    loginError: 'Ugyldig e-post eller passord',
    loginErrorSocialOnly: 'Denne kontoen ble opprettet via Google eller LinkedIn. Bruk den tilsvarende påloggingsknappen.',
    loginErrorRateLimit: 'For mange påloggingsforsøk — prøv igjen om 15 minutter.',
    loginErrorUnavailable: 'Påloggingstjenesten er midlertidig utilgjengelig — prøv igjen om litt.',
    loginNoAccount: 'Har du ikke en konto?',
    loginSignup: 'Kom i gang',
    forgotPassword: 'Glemt passord?',
    forgotTitle: 'Tilbakestill passord',
    forgotEmail: 'Din e-post',
    forgotSubmit: 'Send tilbakestillingslenke',
    forgotSent: 'Tilbakestillingslenke sendt!',
    forgotSetNew: 'Angi nytt passord',
    forgotNewPassword: 'Nytt passord (min. 6 tegn)',
    forgotConfirm: 'Lagre passord',
    forgotSuccess: 'Passordet er oppdatert! Du er nå logget inn.',
    forgotError: 'Kunne ikke tilbakestille passordet',
    forgotRateLimit: 'For mange forsøk — prøv igjen om litt',
    forgotEmailFailed: 'Tilbakestillingslenken kunne ikke sendes — kontroller e-postadressen eller prøv igjen',
    forgotBack: 'Tilbake til pålogging',
    forgotEmailSent: 'Sjekk e-posten din for en tilbakestillingslenke.',
    forgotFbNote: 'Kontoen din er koblet til via Google eller LinkedIn. Du kan angi et lokalt passord nedenfor.',
    mfaTitle: 'Tofaktorautentisering',
    mfaDesc: 'Vi sendte en 6-sifret kode til telefonnummeret ditt.',
    mfaDescEmail: 'Vi sendte en 6-sifret kode til e-posten din.',
    mfaCode: 'Engangskode',
    mfaSubmit: 'Bekreft',
    mfaError: 'Ugyldig eller utløpt kode',
    mfaBack: 'Tilbake til pålogging',
    registerTitle: 'Opprett din fellis.eu-konto',
    registerName: 'Fullt navn',
    registerEmail: 'E-post',
    registerEmailRepeat: 'Gjenta e-post',
    registerEmailMismatch: 'E-postadressene stemmer ikke overens',
    registerPassword: 'Velg et passord (min. 6 tegn)',
    registerPasswordRepeat: 'Gjenta passord',
    registerPasswordMismatch: 'Passordene stemmer ikke overens',
    registerMathChallenge: 'Hva er {a} + {b}?',
    registerMathError: 'Feil svar — prøv igjen',
    registerSubmit: 'Opprett konto & gå til profil',
    registerError: 'Kunne ikke opprette konto',
    registerErrorDuplicate: 'Denne e-posten er allerede i bruk — logg inn eller bruk en annen e-post',
    registerErrorRateLimit: 'For mange forsøk — prøv igjen om litt',
    registerGdpr: 'Jeg godtar behandlingen av mine personopplysninger i henhold til',
    registerGdprLink: 'personvernreglene til fellis.eu',
    registerGdprRequired: 'Du må godta personvernreglene for å opprette en konto',
    modeStepTitle: 'Velg kontotype',
    modeStepSubtitle: 'Du kan alltid endre dette i profilinnstillingene dine.',
    modeCommon: 'Privat',
    modeBusiness: 'Bedrift',
    modeCommonDesc: 'For personlig bruk, familie og fellesskap. Venner, innlegg og arrangementer.',
    modeBusinessDesc: 'For profesjonelt nettverk og bedriftstilstedeværelse. Forbindelser, bransjearrangementer og bedriftssider.',
    modeCommonFeatures: ['Venner & fellesskap', 'Familievennlige innstillinger', 'Personlige arrangementer'],
    modeBusinessFeatures: ['Profesjonelle forbindelser', 'Bedriftssider', 'Konferanser & webinarer'],
    modeSelectBtn: 'Kom i gang',
  },
  pl: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Zaloguj się',
    headline: 'Przenieś swoje życie towarzyskie do Europy',
    subtitle: 'fellis.eu — nowa europejska platforma zbudowana dla Ciebie, nie dla reklamodawców.',
    cta: 'Zacznij',
    createCardTitle: 'Utwórz nowe konto',
    createCardDesc: 'Zacznij od nowa na fellis.eu z e-mailem i hasłem.',
    createCardBtn: 'Utwórz konto',
    manifestoLine1: 'Media społecznościowe sprzedały Cię reklamodawcom.',
    manifestoLine2: 'Nie uważaliśmy tego za uczciwy deal.',
    manifestoLine3: 'Fellis to europejska platforma społecznościowa — Twój feed jest chronologiczny, zawsze. Reklamy są wyraźnie oznaczone. Twoje dane pozostają Twoje.',
    manifestoWhys: [
      { icon: '📅', text: 'Chronologiczny feed — żaden algorytm nie decyduje, co widzisz.' },
      { icon: '🇪🇺', text: 'Twoje dane pozostają w Europie, chronione przez RODO.' },
      { icon: '🎯', text: 'Reklamy wyświetlane na podstawie kontekstu, nie Twojego profilu.' },
      { icon: '🤝', text: 'Jesteś użytkownikiem — nie produktem.' },
    ],
    trustEncrypt: 'Szyfrowanie end-to-end',
    trustEU: 'Hostowany w UE',
    trustDelete: 'Pełna kontrola nad swoimi danymi',
    servicesLabel: 'Zbudowany na europejskich usługach',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Płatności', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (CV / list motywacyjny)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Zaproś swoich znajomych',
    inviteSubtitle: 'Pomóż swoim znajomym przejść na fellis.eu',
    selectAll: 'Zaznacz wszystkich',
    deselectAll: 'Odznacz wszystkich',
    mutualFriends: 'wspólnych znajomych',
    skip: 'Pomiń',
    sendInvites: 'Wyślij zaproszenia',
    sendingInvites: 'Wysyłanie zaproszeń...',
    inviteLinkTitle: 'Udostępnij swój link z zaproszeniem',
    inviteLinkDesc: 'Udostępnij ten link swoim znajomym, aby automatycznie się połączyć na fellis.eu',
    copyLink: 'Kopiuj link',
    linkCopied: 'Skopiowano!',
    invitedBy: 'zaprasza Cię na fellis.eu',
    doneTitle: 'Witaj na fellis.eu!',
    doneSubtitle: 'Twoje konto jest gotowe. Czeka na Ciebie nowy cyfrowy dom.',
    viewProfile: 'Zobacz swój profil',
    back: 'Wstecz',
    loginTitle: 'Zaloguj się do fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Hasło',
    loginSubmit: 'Zaloguj się',
    loginCancel: 'Anuluj',
    loginError: 'Nieprawidłowy e-mail lub hasło',
    loginErrorSocialOnly: 'To konto zostało utworzone przez Google lub LinkedIn. Użyj odpowiedniego przycisku logowania.',
    loginErrorRateLimit: 'Zbyt wiele prób logowania — spróbuj ponownie za 15 minut.',
    loginErrorUnavailable: 'Usługa logowania jest tymczasowo niedostępna — spróbuj ponownie za chwilę.',
    loginNoAccount: 'Nie masz konta?',
    loginSignup: 'Zacznij',
    forgotPassword: 'Zapomniałeś hasła?',
    forgotTitle: 'Zresetuj hasło',
    forgotEmail: 'Twój e-mail',
    forgotSubmit: 'Wyślij link do resetu',
    forgotSent: 'Link do resetu wysłany!',
    forgotSetNew: 'Ustaw nowe hasło',
    forgotNewPassword: 'Nowe hasło (min. 6 znaków)',
    forgotConfirm: 'Zapisz hasło',
    forgotSuccess: 'Hasło zaktualizowane! Jesteś teraz zalogowany.',
    forgotError: 'Nie udało się zresetować hasła',
    forgotRateLimit: 'Zbyt wiele prób — spróbuj ponownie za chwilę',
    forgotEmailFailed: 'Link do resetu nie mógł zostać wysłany — sprawdź adres e-mail lub spróbuj ponownie',
    forgotBack: 'Powrót do logowania',
    forgotEmailSent: 'Sprawdź swój e-mail w poszukiwaniu linku do resetu.',
    forgotFbNote: 'Twoje konto jest połączone przez Google lub LinkedIn. Możesz ustawić lokalne hasło poniżej.',
    mfaTitle: 'Weryfikacja dwuskładnikowa',
    mfaDesc: 'Wysłaliśmy 6-cyfrowy kod na Twój numer telefonu.',
    mfaDescEmail: 'Wysłaliśmy 6-cyfrowy kod na Twój e-mail.',
    mfaCode: 'Jednorazowy kod',
    mfaSubmit: 'Zweryfikuj',
    mfaError: 'Nieprawidłowy lub wygasły kod',
    mfaBack: 'Powrót do logowania',
    registerTitle: 'Utwórz swoje konto fellis.eu',
    registerName: 'Imię i nazwisko',
    registerEmail: 'E-mail',
    registerEmailRepeat: 'Powtórz e-mail',
    registerEmailMismatch: 'Adresy e-mail nie są zgodne',
    registerPassword: 'Wybierz hasło (min. 6 znaków)',
    registerPasswordRepeat: 'Powtórz hasło',
    registerPasswordMismatch: 'Hasła nie są zgodne',
    registerMathChallenge: 'Ile to {a} + {b}?',
    registerMathError: 'Zła odpowiedź — spróbuj ponownie',
    registerSubmit: 'Utwórz konto i przejdź do profilu',
    registerError: 'Nie udało się utworzyć konta',
    registerErrorDuplicate: 'Ten e-mail jest już używany — zaloguj się lub użyj innego e-maila',
    registerErrorRateLimit: 'Zbyt wiele prób — spróbuj ponownie za chwilę',
    registerGdpr: 'Akceptuję przetwarzanie moich danych osobowych zgodnie z',
    registerGdprLink: 'polityką prywatności fellis.eu',
    registerGdprRequired: 'Musisz zaakceptować politykę prywatności, aby utworzyć konto',
    modeStepTitle: 'Wybierz typ konta',
    modeStepSubtitle: 'Zawsze możesz to zmienić w ustawieniach profilu.',
    modeCommon: 'Prywatne',
    modeBusiness: 'Biznesowe',
    modeCommonDesc: 'Do użytku osobistego, rodziny i społeczności. Znajomi, posty i wydarzenia.',
    modeBusinessDesc: 'Do profesjonalnego networkingu i obecności firmy. Kontakty, branżowe wydarzenia i strony firmowe.',
    modeCommonFeatures: ['Znajomi & społeczność', 'Ustawienia przyjazne rodzinie', 'Osobiste wydarzenia'],
    modeBusinessFeatures: ['Profesjonalne kontakty', 'Strony firmowe', 'Konferencje & webinary'],
    modeSelectBtn: 'Zacznij',
  },
  es: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Iniciar sesión',
    headline: 'Traslada tu vida social a Europa',
    subtitle: 'fellis.eu — la nueva plataforma europea creada para ti, no para los anunciantes.',
    cta: 'Empezar',
    createCardTitle: 'Crear nueva cuenta',
    createCardDesc: 'Empieza de cero en fellis.eu con correo electrónico y contraseña.',
    createCardBtn: 'Crear cuenta',
    manifestoLine1: 'Las redes sociales te vendieron a los anunciantes.',
    manifestoLine2: 'No creíamos que eso fuera un trato justo.',
    manifestoLine3: 'Fellis es una plataforma comunitaria europea — tu feed es cronológico, siempre. Los anuncios están claramente etiquetados. Tus datos siguen siendo tuyos.',
    manifestoWhys: [
      { icon: '📅', text: 'Feed cronológico — ningún algoritmo decide lo que ves.' },
      { icon: '🇪🇺', text: 'Tus datos permanecen en Europa, protegidos por el RGPD.' },
      { icon: '🎯', text: 'Los anuncios se muestran por contexto, no según tu perfil personal.' },
      { icon: '🤝', text: 'Eres el usuario — no el producto.' },
    ],
    trustEncrypt: 'Cifrado de extremo a extremo',
    trustEU: 'Alojado en la UE',
    trustDelete: 'Control total sobre tus datos',
    servicesLabel: 'Construido sobre servicios europeos',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Pagos', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'IA (CV / carta de presentación)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Invita a tus amigos',
    inviteSubtitle: 'Ayuda a tus amigos a pasarse a fellis.eu',
    selectAll: 'Seleccionar todo',
    deselectAll: 'Deseleccionar todo',
    mutualFriends: 'amigos en común',
    skip: 'Omitir',
    sendInvites: 'Enviar invitaciones',
    sendingInvites: 'Enviando invitaciones...',
    inviteLinkTitle: 'Comparte tu enlace de invitación',
    inviteLinkDesc: 'Comparte este enlace con tus amigos para conectaros automáticamente en fellis.eu',
    copyLink: 'Copiar enlace',
    linkCopied: '¡Copiado!',
    invitedBy: 'te invita a fellis.eu',
    doneTitle: '¡Bienvenido a fellis.eu!',
    doneSubtitle: 'Tu cuenta está lista. Tu nuevo hogar digital te espera.',
    viewProfile: 'Ver tu perfil',
    back: 'Volver',
    loginTitle: 'Iniciar sesión en fellis.eu',
    loginEmail: 'Correo electrónico',
    loginPassword: 'Contraseña',
    loginSubmit: 'Iniciar sesión',
    loginCancel: 'Cancelar',
    loginError: 'Correo electrónico o contraseña incorrectos',
    loginErrorSocialOnly: 'Esta cuenta fue creada a través de Google o LinkedIn. Usa el botón de inicio de sesión correspondiente.',
    loginErrorRateLimit: 'Demasiados intentos de inicio de sesión — inténtalo de nuevo en 15 minutos.',
    loginErrorUnavailable: 'El servicio de inicio de sesión no está disponible temporalmente — inténtalo de nuevo en breve.',
    loginNoAccount: '¿No tienes cuenta?',
    loginSignup: 'Empezar',
    forgotPassword: '¿Olvidaste tu contraseña?',
    forgotTitle: 'Restablecer contraseña',
    forgotEmail: 'Tu correo electrónico',
    forgotSubmit: 'Enviar enlace de restablecimiento',
    forgotSent: '¡Enlace de restablecimiento enviado!',
    forgotSetNew: 'Establecer nueva contraseña',
    forgotNewPassword: 'Nueva contraseña (mín. 6 caracteres)',
    forgotConfirm: 'Guardar contraseña',
    forgotSuccess: '¡Contraseña actualizada! Ahora has iniciado sesión.',
    forgotError: 'No se pudo restablecer la contraseña',
    forgotRateLimit: 'Demasiados intentos — inténtalo de nuevo en breve',
    forgotEmailFailed: 'No se pudo enviar el enlace de restablecimiento — verifica el correo electrónico o inténtalo de nuevo',
    forgotBack: 'Volver al inicio de sesión',
    forgotEmailSent: 'Revisa tu correo electrónico para obtener un enlace de restablecimiento.',
    forgotFbNote: 'Tu cuenta está conectada a través de Google o LinkedIn. Puedes establecer una contraseña local a continuación.',
    mfaTitle: 'Autenticación de dos factores',
    mfaDesc: 'Enviamos un código de 6 dígitos a tu número de teléfono.',
    mfaDescEmail: 'Enviamos un código de 6 dígitos a tu correo electrónico.',
    mfaCode: 'Código de un solo uso',
    mfaSubmit: 'Verificar',
    mfaError: 'Código inválido o caducado',
    mfaBack: 'Volver al inicio de sesión',
    registerTitle: 'Crea tu cuenta de fellis.eu',
    registerName: 'Nombre completo',
    registerEmail: 'Correo electrónico',
    registerEmailRepeat: 'Repetir correo electrónico',
    registerEmailMismatch: 'Las direcciones de correo electrónico no coinciden',
    registerPassword: 'Elige una contraseña (mín. 6 caracteres)',
    registerPasswordRepeat: 'Repetir contraseña',
    registerPasswordMismatch: 'Las contraseñas no coinciden',
    registerMathChallenge: '¿Cuánto es {a} + {b}?',
    registerMathError: 'Respuesta incorrecta — inténtalo de nuevo',
    registerSubmit: 'Crear cuenta e ir al perfil',
    registerError: 'No se pudo crear la cuenta',
    registerErrorDuplicate: 'Este correo electrónico ya está en uso — inicia sesión o usa un correo diferente',
    registerErrorRateLimit: 'Demasiados intentos — inténtalo de nuevo en breve',
    registerGdpr: 'Acepto el tratamiento de mis datos personales de acuerdo con la',
    registerGdprLink: 'política de privacidad de fellis.eu',
    registerGdprRequired: 'Debes aceptar la política de privacidad para crear una cuenta',
    modeStepTitle: 'Elige el tipo de cuenta',
    modeStepSubtitle: 'Siempre puedes cambiarlo en la configuración de tu perfil.',
    modeCommon: 'Personal',
    modeBusiness: 'Empresarial',
    modeCommonDesc: 'Para uso personal, familia y comunidad. Amigos, publicaciones y eventos.',
    modeBusinessDesc: 'Para networking profesional y presencia empresarial. Conexiones, eventos del sector y páginas de empresa.',
    modeCommonFeatures: ['Amigos & comunidad', 'Configuración apta para familias', 'Eventos personales'],
    modeBusinessFeatures: ['Conexiones profesionales', 'Páginas de empresa', 'Conferencias & webinars'],
    modeSelectBtn: 'Empezar',
  },
  it: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Accedi',
    headline: 'Porta la tua vita sociale in Europa',
    subtitle: 'fellis.eu — la nuova piattaforma europea creata per te, non per gli inserzionisti.',
    cta: 'Inizia',
    createCardTitle: 'Crea un nuovo account',
    createCardDesc: 'Ricomincia su fellis.eu con e-mail e password.',
    createCardBtn: 'Crea account',
    manifestoLine1: 'I social media ti hanno venduto agli inserzionisti.',
    manifestoLine2: 'Non ci sembrava un accordo equo.',
    manifestoLine3: 'Fellis è una piattaforma comunitaria europea — il tuo feed è cronologico, sempre. Gli annunci sono chiaramente etichettati. I tuoi dati rimangono tuoi.',
    manifestoWhys: [
      { icon: '📅', text: 'Feed cronologico — nessun algoritmo decide cosa vedi.' },
      { icon: '🇪🇺', text: 'I tuoi dati rimangono in Europa, protetti dal GDPR.' },
      { icon: '🎯', text: 'Gli annunci vengono mostrati per contesto, non secondo il tuo profilo personale.' },
      { icon: '🤝', text: 'Sei l\'utente — non il prodotto.' },
    ],
    trustEncrypt: 'Crittografia end-to-end',
    trustEU: 'Ospitato nell\'UE',
    trustDelete: 'Pieno controllo sui tuoi dati',
    servicesLabel: 'Costruito su servizi europei',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Pagamenti', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'IA (CV / lettera di presentazione)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Invita i tuoi amici',
    inviteSubtitle: 'Aiuta i tuoi amici a passare a fellis.eu',
    selectAll: 'Seleziona tutto',
    deselectAll: 'Deseleziona tutto',
    mutualFriends: 'amici in comune',
    skip: 'Salta',
    sendInvites: 'Invia inviti',
    sendingInvites: 'Invio degli inviti...',
    inviteLinkTitle: 'Condividi il tuo link di invito',
    inviteLinkDesc: 'Condividi questo link con i tuoi amici per connettervi automaticamente su fellis.eu',
    copyLink: 'Copia link',
    linkCopied: 'Copiato!',
    invitedBy: 'ti invita su fellis.eu',
    doneTitle: 'Benvenuto su fellis.eu!',
    doneSubtitle: 'Il tuo account è pronto. La tua nuova casa digitale ti aspetta.',
    viewProfile: 'Visualizza il tuo profilo',
    back: 'Indietro',
    loginTitle: 'Accedi a fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Password',
    loginSubmit: 'Accedi',
    loginCancel: 'Annulla',
    loginError: 'E-mail o password non validi',
    loginErrorSocialOnly: 'Questo account è stato creato tramite Google o LinkedIn. Usa il pulsante di accesso corrispondente.',
    loginErrorRateLimit: 'Troppi tentativi di accesso — riprova tra 15 minuti.',
    loginErrorUnavailable: 'Il servizio di accesso è temporaneamente non disponibile — riprova tra poco.',
    loginNoAccount: 'Non hai un account?',
    loginSignup: 'Inizia',
    forgotPassword: 'Password dimenticata?',
    forgotTitle: 'Reimposta password',
    forgotEmail: 'La tua e-mail',
    forgotSubmit: 'Invia link di reimpostazione',
    forgotSent: 'Link di reimpostazione inviato!',
    forgotSetNew: 'Imposta nuova password',
    forgotNewPassword: 'Nuova password (min. 6 caratteri)',
    forgotConfirm: 'Salva password',
    forgotSuccess: 'Password aggiornata! Sei ora connesso.',
    forgotError: 'Impossibile reimpostare la password',
    forgotRateLimit: 'Troppi tentativi — riprova tra poco',
    forgotEmailFailed: 'Il link di reimpostazione non è stato inviato — controlla l\'indirizzo e-mail o riprova',
    forgotBack: 'Torna all\'accesso',
    forgotEmailSent: 'Controlla la tua e-mail per trovare un link di reimpostazione.',
    forgotFbNote: 'Il tuo account è collegato tramite Google o LinkedIn. Puoi impostare una password locale qui sotto.',
    mfaTitle: 'Autenticazione a due fattori',
    mfaDesc: 'Abbiamo inviato un codice a 6 cifre al tuo numero di telefono.',
    mfaDescEmail: 'Abbiamo inviato un codice a 6 cifre alla tua e-mail.',
    mfaCode: 'Codice monouso',
    mfaSubmit: 'Verifica',
    mfaError: 'Codice non valido o scaduto',
    mfaBack: 'Torna all\'accesso',
    registerTitle: 'Crea il tuo account fellis.eu',
    registerName: 'Nome completo',
    registerEmail: 'E-mail',
    registerEmailRepeat: 'Ripeti e-mail',
    registerEmailMismatch: 'Gli indirizzi e-mail non corrispondono',
    registerPassword: 'Scegli una password (min. 6 caratteri)',
    registerPasswordRepeat: 'Ripeti password',
    registerPasswordMismatch: 'Le password non corrispondono',
    registerMathChallenge: 'Quanto fa {a} + {b}?',
    registerMathError: 'Risposta errata — riprova',
    registerSubmit: 'Crea account e vai al profilo',
    registerError: 'Impossibile creare l\'account',
    registerErrorDuplicate: 'Questa e-mail è già in uso — accedi o usa un\'altra e-mail',
    registerErrorRateLimit: 'Troppi tentativi — riprova tra poco',
    registerGdpr: 'Accetto il trattamento dei miei dati personali in conformità con la',
    registerGdprLink: 'politica sulla privacy di fellis.eu',
    registerGdprRequired: 'Devi accettare la politica sulla privacy per creare un account',
    modeStepTitle: 'Scegli il tipo di account',
    modeStepSubtitle: 'Puoi sempre cambiarlo nelle impostazioni del profilo.',
    modeCommon: 'Personale',
    modeBusiness: 'Aziendale',
    modeCommonDesc: 'Per uso personale, famiglia e comunità. Amici, post ed eventi.',
    modeBusinessDesc: 'Per il networking professionale e la presenza aziendale. Connessioni, eventi di settore e pagine aziendali.',
    modeCommonFeatures: ['Amici & comunità', 'Impostazioni a misura di famiglia', 'Eventi personali'],
    modeBusinessFeatures: ['Connessioni professionali', 'Pagine aziendali', 'Conferenze & webinar'],
    modeSelectBtn: 'Inizia',
  },
}

export default function Landing({ onEnterPlatform, inviteToken, inviterName, inviterEmail, resetToken }) {
  const { lang, setLanguage } = useTranslation('common')
  const [step, setStep] = useState(4) // Go directly to registration
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false)
  const [inviteLink, setInviteLink] = useState('')

  // Login modal state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(null) // null | 'email' | 'reset' | 'done'
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotToken, setForgotToken] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotFbNote, setForgotFbNote] = useState(false)
  // MFA state
  const [mfaUserId, setMfaUserId] = useState(null)
  const [mfaMethod, setMfaMethod] = useState('sms')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaError, setMfaError] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  // Mode selection (step 5)
  const [pendingEnter, setPendingEnter] = useState(false)

  // Register state (step 4) — pre-fill email from email invite if available
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState(inviterEmail || '')
  const [regPassword, setRegPassword] = useState('')
  const [regPasswordRepeat, setRegPasswordRepeat] = useState('')
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [gdprAccepted, setGdprAccepted] = useState(false)
  // Anti-bot: math challenge
  const [mathChallenge] = useState(() => {
    const a = Math.floor(Math.random() * 9) + 1
    const b = Math.floor(Math.random() * 9) + 1
    return { a, b, answer: a + b }
  })
  const [mathAnswer, setMathAnswer] = useState('')
  // Anti-bot: honeypot field (must remain empty)
  const [honeypot, setHoneypot] = useState('')
  // Refs for smart focus
  const emailRef = useRef(null)
  const nameRef = useRef(null)

  const t = T[lang] || T.da

  // Pre-fill email when invite info arrives asynchronously
  useEffect(() => {
    if (inviterEmail && !regEmail) setRegEmail(inviterEmail)
  }, [inviterEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open password reset form when arriving from email reset link
  useEffect(() => {
    if (resetToken) {
      setForgotToken(resetToken)
      setForgotMode('reset')
      setShowLoginModal(true)
    }
  }, [resetToken])

  // Smart focus: when step 4 becomes active, focus email (if empty) or name (if email pre-filled)
  useEffect(() => {
    if (step === 4) {
      setTimeout(() => {
        if (regEmail) nameRef.current?.focus()
        else emailRef.current?.focus()
      }, 50)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeLang = useCallback((code) => {
    setLanguage(code)
  }, [setLanguage])

  // ── Login handler ──
  const handleLogin = useCallback(async (e) => {
    e.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError(t.loginError)
      return
    }
    setLoginLoading(true)
    setLoginError('')
    try {
      const data = await apiLogin(loginEmail.trim(), loginPassword.trim(), lang)
      if (data?.sessionId) {
        setShowLoginModal(false)
        onEnterPlatform(lang)
      } else if (data?.mfa_required && data?.userId) {
        setMfaUserId(data.userId)
        setMfaMethod(data.method || 'sms')
        setMfaCode('')
        setMfaError('')
      } else if (data?.error === 'social_login_only') {
        setLoginError(t.loginErrorSocialOnly)
      } else if (data?.status === 429) {
        setLoginError(t.loginErrorRateLimit)
      } else if (data === null || data?.status === 503 || data?.status >= 500) {
        setLoginError(t.loginErrorUnavailable)
      } else {
        setLoginError(t.loginError)
      }
    } catch {
      setLoginError(t.loginError)
    }
    setLoginLoading(false)
  }, [loginEmail, loginPassword, lang, t, onEnterPlatform])

  // ── MFA handler ──
  const handleMfaVerify = useCallback(async (e) => {
    e.preventDefault()
    if (!mfaCode.trim()) return
    setMfaLoading(true)
    setMfaError('')
    try {
      const data = await apiVerifyMfa(mfaUserId, mfaCode.trim(), lang)
      if (data?.sessionId) {
        setMfaUserId(null)
        setShowLoginModal(false)
        onEnterPlatform(lang)
      } else {
        setMfaError(t.mfaError)
      }
    } catch {
      setMfaError(t.mfaError)
    }
    setMfaLoading(false)
  }, [mfaUserId, mfaCode, lang, t, onEnterPlatform])

  // ── Forgot password handlers ──
  const handleForgotSubmitEmail = useCallback(async (e) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    setForgotError('')
    try {
      const data = await apiForgotPassword(forgotEmail.trim())
      if (data?.ok) {
        // Server sends an email with the reset link — show confirmation
        setForgotMode('email-sent')
      } else if (data?.status === 429) {
        setForgotError(t.forgotRateLimit)
      } else if (data?.error === 'email_send_failed') {
        setForgotError(t.forgotEmailFailed)
      } else {
        setForgotError(t.forgotError)
      }
    } catch {
      setForgotError(t.forgotError)
    }
    setForgotLoading(false)
  }, [forgotEmail, t])

  const handleForgotResetPw = useCallback(async (e) => {
    e.preventDefault()
    if (!forgotNewPw.trim() || forgotNewPw.length < 6) {
      setForgotError(PT[lang].passwordMustBeAtLeast6Characters)
      return
    }
    setForgotLoading(true)
    setForgotError('')
    try {
      const data = await apiResetPassword(forgotToken, forgotNewPw.trim())
      if (data?.sessionId) {
        setForgotMode('done')
        setTimeout(() => {
          setShowLoginModal(false)
          setForgotMode(null)
          onEnterPlatform(lang)
        }, 1500)
      } else {
        setForgotError(t.forgotError)
      }
    } catch {
      setForgotError(t.forgotError)
    }
    setForgotLoading(false)
  }, [forgotToken, forgotNewPw, lang, t, onEnterPlatform])

  const openForgotPassword = useCallback(() => {
    setForgotMode('email')
    setForgotEmail(loginEmail)
    setForgotError('')
    setForgotNewPw('')
    setForgotFbNote(false)
  }, [loginEmail])

  const closeForgotPassword = useCallback(() => {
    setForgotMode(null)
    setForgotError('')
  }, [])

  // ── Register handler (step 4 done) ──
  const handleRegister = useCallback(async (e) => {
    e.preventDefault()
    // Anti-bot: honeypot must be empty
    if (honeypot) return
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      setRegError(t.registerError)
      return
    }
    if (regPassword.length < 6) {
      setRegError(PT[lang].passwordMustBeAtLeast6Characters)
      return
    }
    if (regPassword !== regPasswordRepeat) {
      setRegError(t.registerPasswordMismatch)
      return
    }
    if (!gdprAccepted) {
      setRegError(t.registerGdprRequired)
      return
    }
    if (parseInt(mathAnswer, 10) !== mathChallenge.answer) {
      setRegError(t.registerMathError)
      return
    }
    setRegLoading(true)
    setRegError('')
    try {
      const regData = await apiRegister(regName.trim(), regEmail.trim(), regPassword.trim(), lang, inviteToken || undefined)
      if (!regData?.sessionId) {
        const serverErr = regData?.error || ''
        let displayErr = t.registerError
        if (serverErr.toLowerCase().includes('already exists') || serverErr.toLowerCase().includes('duplicate')) {
          displayErr = t.registerErrorDuplicate
        } else if (serverErr.toLowerCase().includes('too many') || serverErr.toLowerCase().includes('rate')) {
          displayErr = t.registerErrorRateLimit
        } else if (serverErr && serverErr !== 'registration_failed') {
          // Password policy or other server-side message — show as-is (already in user's lang)
          displayErr = serverErr
        }
        setRegError(displayErr)
        setRegLoading(false)
        return
      }
      await apiGiveConsent(['data_processing']).catch(() => {})
      // Flag for onboarding tour (only for new registrations)
      localStorage.setItem('fellis_onboarding', '1')
      if (inviterName) localStorage.setItem('fellis_onboarding_inviter', inviterName)
      // Show mode selector before entering platform
      setPendingEnter(true)
      setStep(5)
    } catch {
      setRegError(t.registerError)
      setRegLoading(false)
    }
  }, [regName, regEmail, regPassword, regPasswordRepeat, honeypot, gdprAccepted, mathAnswer, mathChallenge, lang, t, inviteToken, inviterName])

  return (
    <div className="app" style={{ height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <nav className="nav">
        <div className="nav-logo">
          <img src="/fellis-logo.jpg" className="nav-logo-icon" alt="" />
          <div className="nav-logo-text">
            <span className="nav-logo-brand">{t.navBrand}</span>
            <span className="nav-logo-tagline">Connect. Share. Discover.</span>
          </div>
        </div>
        <div className="nav-right-group">
          <select className="lang-toggle" value={lang} onChange={e => changeLang(e.target.value)} aria-label="Language">
            {UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <a
            href="/for-business"
            style={{ fontSize: 14, color: '#2D6A4F', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            {PT[lang]?.forBusinessNavLink || PT.en.forBusinessNavLink}
          </a>
          <button className="login-btn" onClick={() => { setShowLoginModal(true); setLoginError(''); setLoginEmail(''); setLoginPassword('') }}>
            {t.loginBtn}
          </button>
        </div>
      </nav>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="modal-backdrop">
          <div className="fb-modal">
            <div className="fb-modal-header" style={{ background: '#2D6A4F', position: 'relative' }}>
              <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif" }}>fellis.eu</div>
              <button
                type="button"
                onClick={() => { setShowLoginModal(false); setForgotMode(null); setMfaUserId(null) }}
                style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer', opacity: 0.8, padding: '2px 6px' }}
                aria-label="Close"
              >&#x2715;</button>
            </div>

            {/* Normal login */}
            {!forgotMode && !mfaUserId && (
              <form className="fb-modal-form" onSubmit={handleLogin}>
                <h3>{t.loginTitle}</h3>
                <input
                  type="email"
                  placeholder={t.loginEmail}
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="fb-input"
                  autoComplete="email"
                  autoFocus
                />
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t.loginPassword}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="fb-input"
                    autoComplete="current-password"
                    style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 2, display: 'flex', alignItems: 'center' }}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                {loginError && <div className="fb-error">{loginError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={loginLoading}>
                  {loginLoading ? '...' : t.loginSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={openForgotPassword}>{t.forgotPassword}</button>
                <div className="fb-forgot-link" style={{ marginTop: 8 }}>
                  {t.loginNoAccount}{' '}
                  <span style={{ color: '#2D6A4F', cursor: 'pointer', fontWeight: 600 }} onClick={() => { setShowLoginModal(false); setDirectSignup(true); setStep(4) }}>
                    {t.loginSignup}
                  </span>
                </div>
              </form>
            )}

            {/* MFA: enter SMS code */}
            {mfaUserId && !forgotMode && (
              <form className="fb-modal-form" onSubmit={handleMfaVerify}>
                <h3>{t.mfaTitle}</h3>
                <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>{mfaMethod === 'email' ? t.mfaDescEmail : t.mfaDesc}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder={t.mfaCode}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="fb-input"
                  autoFocus
                />
                {mfaError && <div className="fb-error">{mfaError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={mfaLoading}>
                  {mfaLoading ? '...' : t.mfaSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={() => setMfaUserId(null)}>{t.mfaBack}</button>
              </form>
            )}

            {/* Forgot password: enter email */}
            {forgotMode === 'email' && (
              <form className="fb-modal-form" onSubmit={handleForgotSubmitEmail}>
                <h3>{t.forgotTitle}</h3>
                <input
                  type="email"
                  placeholder={t.forgotEmail}
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  className="fb-input"
                  autoComplete="email"
                  autoFocus
                />
                {forgotError && <div className="fb-error">{forgotError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={forgotLoading}>
                  {forgotLoading ? '...' : t.forgotSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={closeForgotPassword}>{t.forgotBack}</button>
              </form>
            )}

            {/* Forgot password: set new password */}
            {forgotMode === 'reset' && (
              <form className="fb-modal-form" onSubmit={handleForgotResetPw}>
                <h3>{t.forgotSetNew}</h3>
                {forgotFbNote && <div className="fb-info-note">{t.forgotFbNote}</div>}
                <input
                  type="password"
                  placeholder={t.forgotNewPassword}
                  value={forgotNewPw}
                  onChange={e => setForgotNewPw(e.target.value)}
                  className="fb-input"
                  autoComplete="new-password"
                  autoFocus
                  minLength={6}
                />
                {forgotError && <div className="fb-error">{forgotError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={forgotLoading}>
                  {forgotLoading ? '...' : t.forgotConfirm}
                </button>
                <button type="button" className="fb-forgot" onClick={closeForgotPassword}>{t.forgotBack}</button>
              </form>
            )}

            {/* Forgot password: email sent confirmation */}
            {forgotMode === 'email-sent' && (
              <div className="fb-modal-form" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✉</div>
                <p style={{ color: '#2D6A4F', fontWeight: 600 }}>{t.forgotEmailSent}</p>
                <button type="button" className="fb-forgot" style={{ marginTop: 16 }} onClick={closeForgotPassword}>{t.forgotBack}</button>
              </div>
            )}

            {/* Forgot password: success (after reset via URL) */}
            {forgotMode === 'done' && (
              <div className="fb-modal-form" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
                <p style={{ color: '#2D6A4F', fontWeight: 600 }}>{t.forgotSuccess}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Invite banner (shown when arriving via invite link) */}
      {inviterName && step === 4 && (
        <div className="invite-banner">
          <div className="invite-banner-text">
            <strong>{inviterName}</strong> {t.invitedBy}
          </div>
        </div>
      )}

      {/* Landing — full viewport layout */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '8px 16px', boxSizing: 'border-box', overflow: 'hidden', minHeight: 0 }}>

          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, fontWeight: 700, margin: '0 0 4px' }}>{t.headline}</h1>
            <p style={{ fontSize: 14, color: '#6B6560', margin: 0, lineHeight: 1.4 }}>{t.subtitle}</p>
          </div>

          {/* Two-card row: manifesto + registration */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'stretch', width: '100%', maxWidth: 860, flexWrap: 'wrap', justifyContent: 'center' }}>

          {/* Manifesto card */}
          <div style={{ flex: '1 1 280px', maxWidth: 380, border: '1px solid #C8DDD2', borderRadius: 14, padding: '28px 28px', boxSizing: 'border-box', background: '#F0FAF4', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
            <p style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.4, margin: 0, color: '#1a1a1a' }}>{t.manifestoLine1}</p>
            <p style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.4, margin: 0, color: '#1a1a1a' }}>{t.manifestoLine2}</p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: '#4a6b5c' }}>{t.manifestoLine3}</p>
            <div style={{ borderTop: '1px solid #C8DDD2', marginTop: 2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {t.manifestoWhys.map(({ icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.6, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.6, color: '#3a5a4a' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Registration form */}
          <form className="register-form" onSubmit={handleRegister} style={{ flex: '1 1 280px', border: '1px solid #E0DCD7', borderRadius: 14, padding: '16px 22px', maxWidth: 420, width: '100%', boxSizing: 'border-box', margin: 0, gap: 6 }}>
            <h3 className="register-title" style={{ marginBottom: 2 }}>{t.registerTitle}</h3>
            {/* Honeypot — hidden from users, filled only by bots */}
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
              autoComplete="off"
            />
            <input
              ref={emailRef}
              type="email"
              placeholder={t.registerEmail}
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
              className="register-input"
              autoComplete="email"
              required
            />
            <input
              ref={nameRef}
              type="text"
              placeholder={t.registerName}
              value={regName}
              onChange={e => setRegName(e.target.value)}
              className="register-input"
              autoComplete="name"
              required
            />
            <input
              type="password"
              placeholder={t.registerPassword}
              value={regPassword}
              onChange={e => setRegPassword(e.target.value)}
              className="register-input"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <input
              type="password"
              placeholder={t.registerPasswordRepeat}
              value={regPasswordRepeat}
              onChange={e => setRegPasswordRepeat(e.target.value)}
              className="register-input"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <PasswordStrengthIndicator password={regPassword} lang={lang} />
            {/* Math challenge — simple human verification */}
            <div style={{ marginTop: 2, marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 2 }}>
                {t.registerMathChallenge.replace('{a}', mathChallenge.a).replace('{b}', mathChallenge.b)}
              </label>
              <input
                type="number"
                placeholder="?"
                value={mathAnswer}
                onChange={e => setMathAnswer(e.target.value)}
                className="register-input"
                required
                style={{ marginTop: 0 }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 4, cursor: 'pointer', fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={gdprAccepted}
                onChange={e => { setGdprAccepted(e.target.checked); if (e.target.checked) setRegError('') }}
                style={{ marginTop: 2, flexShrink: 0, accentColor: '#2D6A4F' }}
              />
              <span>
                {t.registerGdpr}{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#2D6A4F', fontWeight: 600 }}>
                  {t.registerGdprLink}
                </a>
                {' '}(GDPR Art. 6 & 7)
              </span>
            </label>
            {regError && <div className="fb-error">{regError}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px 32px' }} disabled={regLoading}>
              {regLoading ? '...' : t.registerSubmit}
            </button>
          </form>
          </div>{/* end two-card row */}

          {/* Trust + services row — bottom */}
          <div style={{ marginTop: 12, width: '100%', maxWidth: 860, flexShrink: 0 }}>
            <div className="trust-row" style={{ marginTop: 0, gap: 24 }}>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🔒</div><span className="trust-label">{t.trustEncrypt}</span></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🇪🇺</div><a href="https://yggdrasilcloud.dk/" target="_blank" rel="noopener noreferrer" className="trust-label trust-link">{t.trustEU}</a></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🛡️</div><span className="trust-label">{t.trustDelete}</span></div>
            </div>
            <div className="landing-services-row" style={{ marginTop: 6 }}>
              <span className="landing-services-label">{t.servicesLabel}:</span>
              {t.services.map(svc => (
                <a key={svc.name} href={svc.url} target="_blank" rel="noopener noreferrer" className="landing-service-chip">
                  <span>{svc.flag}</span>
                  <span className="landing-service-chip-name">{svc.name}</span>
                  <span className="landing-service-chip-role">{svc.role}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Step 5 — Mode selector */}
      {step === 5 && (
        <div className="step-container" style={{ maxWidth: 560 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h2 style={{ margin: '0 0 8px' }}>{t.modeStepTitle}</h2>
            <p style={{ margin: 0, color: '#888', fontSize: 14 }}>{t.modeStepSubtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { key: 'common', label: t.modeCommon, icon: '🏠', desc: t.modeCommonDesc, features: t.modeCommonFeatures, color: '#2D6A4F', bg: '#F0FAF4' },
              { key: 'business', label: t.modeBusiness, icon: '💼', desc: t.modeBusinessDesc, features: t.modeBusinessFeatures, color: '#1877F2', bg: '#EBF4FF' },
            ].map(({ key, label, icon, desc, features, color, bg }) => (
              <button
                key={key}
                onClick={() => {
                  localStorage.setItem('fellis_mode', key)
                  onEnterPlatform(lang)
                }}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 10, padding: 24, borderRadius: 16, border: `2px solid ${color}`,
                  background: bg, cursor: 'pointer', textAlign: 'left', transition: 'transform 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'none'}
              >
                <span style={{ fontSize: 36 }}>{icon}</span>
                <strong style={{ fontSize: 18, color }}>{label}</strong>
                <span style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>{desc}</span>
                <ul style={{ margin: '4px 0 0', padding: '0 0 0 16px', fontSize: 12, color: '#666', lineHeight: 1.8 }}>
                  {features.map(f => <li key={f}>{f}</li>)}
                </ul>
                <span style={{ marginTop: 8, alignSelf: 'stretch', padding: '10px', borderRadius: 10, background: color, color: '#fff', fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
                  {t.modeSelectBtn} →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PasswordStrengthIndicator({ password, lang }) {
  const [policy, setPolicy] = useState(null)
  useEffect(() => {
    fetch('/api/auth/password-policy').then(r => r.ok ? r.json() : null).then(p => { if (p) setPolicy(p) }).catch(() => {})
  }, [])

  if (!password) return null

  const minLen = policy?.min_length || 6
  const checks = [
    { ok: password.length >= minLen, da: `Min. ${minLen} tegn`, en: `Min. ${minLen} characters` },
    ...(policy?.require_uppercase ? [{ ok: /[A-Z]/.test(password), da: 'Stort bogstav (A–Z)', en: 'Uppercase (A–Z)' }] : [{ ok: /[A-Z]/.test(password), da: 'Stort bogstav (A–Z)', en: 'Uppercase (A–Z)' }]),
    ...(policy?.require_lowercase !== false ? [{ ok: /[a-z]/.test(password), da: 'Lille bogstav (a–z)', en: 'Lowercase (a–z)' }] : []),
    ...(policy?.require_numbers !== false   ? [{ ok: /[0-9]/.test(password), da: 'Tal (0–9)', en: 'Number (0–9)' }] : []),
    ...(policy?.require_symbols ? [{ ok: /[^A-Za-z0-9]/.test(password), da: 'Specialtegn (!@#…)', en: 'Symbol (!@#…)' }] : []),
  ]

  const passed = checks.filter(c => c.ok).length
  const ratio = checks.length ? passed / checks.length : 0
  const barColor = ratio < 0.4 ? '#e74c3c' : ratio < 0.75 ? '#f39c12' : '#2D6A4F'
  const barLabel = ratio < 0.4
    ? (PT[lang].weak)
    : ratio < 0.75
    ? (PT[lang].fair)
    : (PT[lang].strong)

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#eee', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${ratio * 100}%`, background: barColor, borderRadius: 3, transition: 'width 0.25s, background 0.25s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: barColor, minWidth: 36 }}>{barLabel}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.ok ? '#2D6A4F' : '#999' }}>
            <span style={{ fontSize: 13, width: 16, textAlign: 'center', lineHeight: 1 }}>{c.ok ? '✓' : '○'}</span>
            <span>{lang === 'da' ? c.da : c.en}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

