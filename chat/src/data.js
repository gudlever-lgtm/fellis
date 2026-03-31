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
    unknown: 'Ukendt',
    // Media
    addMedia: 'Tilføj medie',
    gallery: 'Galleri',
    camera: 'Kamera',
    uploading: 'Uploader...',
    pasteHint: 'Du kan også indsætte billeder med Ctrl+V',
    cameraNotAvailable: 'Kamera ikke tilgængeligt',
    close: 'Luk',
    capture: 'Tag billede',
    flipCamera: 'Skift kamera',
    // Rename
    renameConversation: 'Omdøb samtale',
    rename: 'Omdøb',
    newName: 'Nyt navn',
    // Add people
    addPeople: 'Tilføj personer',
    searchUsers: 'Søg efter brugere...',
    add: 'Tilføj',
    adding: 'Tilføjer...',
    addError: 'Kunne ikke tilføje personen.',
    noUsersFound: 'Ingen brugere fundet.',
    // Options menu
    options: 'Indstillinger',
    cancel: 'Annuller',
    save: 'Gem',
    saving: 'Gemmer...',
    // Members
    viewMembers: 'Vis medlemmer',
    members: 'Medlemmer',
    // Mute
    muteNotifications: 'Sluk notifikationer',
    unmuteNotifications: 'Tænd notifikationer',
    muted: 'Lydløs',
    // Leave / delete
    leaveGroup: 'Forlad gruppe',
    deleteChat: 'Slet samtale',
    leaveConfirm: 'Er du sikker på, at du vil forlade denne samtale?',
    deleteConfirm: 'Er du sikker på, at du vil slette denne samtale?',
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
    unknown: 'Unknown',
    // Media
    addMedia: 'Add media',
    gallery: 'Gallery',
    camera: 'Camera',
    uploading: 'Uploading...',
    pasteHint: 'You can also paste images with Ctrl+V',
    cameraNotAvailable: 'Camera not available',
    close: 'Close',
    capture: 'Take photo',
    flipCamera: 'Flip camera',
    // Rename
    renameConversation: 'Rename conversation',
    rename: 'Rename',
    newName: 'New name',
    // Add people
    addPeople: 'Add people',
    searchUsers: 'Search users...',
    add: 'Add',
    adding: 'Adding...',
    addError: 'Could not add person.',
    noUsersFound: 'No users found.',
    // Options menu
    options: 'Options',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving...',
    // Members
    viewMembers: 'View members',
    members: 'Members',
    // Mute
    muteNotifications: 'Mute notifications',
    unmuteNotifications: 'Unmute notifications',
    muted: 'Muted',
    // Leave / delete
    leaveGroup: 'Leave group',
    deleteChat: 'Delete conversation',
    leaveConfirm: 'Are you sure you want to leave this conversation?',
    deleteConfirm: 'Are you sure you want to delete this conversation?',
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
