// Bilingual UI strings — all visible text goes through PT[lang][key]
export const PT = {
  da: {
    appName: 'fellis chat',
    login: 'Log ind',
    logout: 'Log ud',
    email: 'E-mail',
    password: 'Adgangskode',
    loginButton: 'Log ind',
    loggingIn: 'Logger ind...',
    loginError: 'Forkert e-mail eller adgangskode.',
    loginFailed: 'Login mislykkedes. Prøv igen.',
    conversations: 'Samtaler',
    noConversations: 'Ingen samtaler endnu.',
    selectConversation: 'Vælg en samtale for at begynde.',
    messages: 'Beskeder',
    noMessages: 'Ingen beskeder endnu.',
    typeMessage: 'Skriv en besked...',
    send: 'Send',
    sending: 'Sender...',
    sendError: 'Beskeden kunne ikke sendes.',
    loadingConversations: 'Indlæser samtaler...',
    loadingMessages: 'Indlæser beskeder...',
    language: 'Sprog',
    langDa: 'Dansk',
    langEn: 'English',
    you: 'Dig',
    group: 'Gruppe',
    unread: 'ulæste',
    backToList: 'Tilbage',
    errorLoadConversations: 'Kunne ikke indlæse samtaler.',
    errorLoadMessages: 'Kunne ikke indlæse beskeder.',
    retry: 'Prøv igen',
  },
  en: {
    appName: 'fellis chat',
    login: 'Log in',
    logout: 'Log out',
    email: 'Email',
    password: 'Password',
    loginButton: 'Log in',
    loggingIn: 'Logging in...',
    loginError: 'Incorrect email or password.',
    loginFailed: 'Login failed. Please try again.',
    conversations: 'Conversations',
    noConversations: 'No conversations yet.',
    selectConversation: 'Select a conversation to begin.',
    messages: 'Messages',
    noMessages: 'No messages yet.',
    typeMessage: 'Type a message...',
    send: 'Send',
    sending: 'Sending...',
    sendError: 'Message could not be sent.',
    loadingConversations: 'Loading conversations...',
    loadingMessages: 'Loading messages...',
    language: 'Language',
    langDa: 'Dansk',
    langEn: 'English',
    you: 'You',
    group: 'Group',
    unread: 'unread',
    backToList: 'Back',
    errorLoadConversations: 'Could not load conversations.',
    errorLoadMessages: 'Could not load messages.',
    retry: 'Try again',
  },
}

export function getLang() {
  return localStorage.getItem('fellis_lang') || 'da'
}

export function setLang(lang) {
  localStorage.setItem('fellis_lang', lang)
}

export function t(lang, key) {
  return PT[lang]?.[key] ?? PT.da[key] ?? key
}
