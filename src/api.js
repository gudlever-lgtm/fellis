// API client for fellis.eu backend
// Falls back to null when the server is unavailable (demo mode uses mock data)

const API_BASE = import.meta.env.VITE_API_URL || ''

function getSessionId() {
  return localStorage.getItem('fellis_session_id')
}

function headers() {
  const h = { 'Content-Type': 'application/json' }
  const sid = getSessionId()
  if (sid) h['X-Session-Id'] = sid
  return h
}

async function request(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: headers(),
      credentials: 'same-origin', // Send cookies with requests
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    if (err.message === 'Failed to fetch') return null // Server not running
    throw err
  }
}

// Auth
export async function apiLogin(email, password, lang) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, lang }),
  })
  if (data?.sessionId) {
    localStorage.setItem('fellis_session_id', data.sessionId)
  }
  return data
}

export async function apiRegister(name, email, password, lang, inviteToken) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, lang, inviteToken: inviteToken || undefined }),
  })
  if (data?.sessionId) {
    localStorage.setItem('fellis_session_id', data.sessionId)
  }
  return data
}

export async function apiForgotPassword(email) {
  return await request('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function apiResetPassword(token, password) {
  const data = await request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
  if (data?.sessionId) {
    localStorage.setItem('fellis_session_id', data.sessionId)
  }
  return data
}

export async function apiCheckSession() {
  // Try session check even without localStorage — cookie may carry the session
  return await request('/api/auth/session')
}

export async function apiLogout() {
  await request('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem('fellis_session_id')
}

// Feed
export async function apiFetchFeed(offset = 0, limit = 20) {
  return await request(`/api/feed?offset=${offset}&limit=${limit}`)
}

export async function apiCreatePost(text, mediaFiles) {
  if (mediaFiles?.length) {
    // Use FormData for multipart upload
    const form = new FormData()
    form.append('text', text)
    for (const file of mediaFiles) {
      form.append('media', file)
    }
    try {
      const res = await fetch(`${API_BASE}/api/feed`, {
        method: 'POST',
        headers: { 'X-Session-Id': getSessionId() },
        credentials: 'same-origin',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      if (err.message === 'Failed to fetch') return null
      throw err
    }
  }
  return await request('/api/feed', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function apiToggleLike(postId) {
  return await request(`/api/feed/${postId}/like`, { method: 'POST' })
}

export async function apiAddComment(postId, text) {
  return await request(`/api/feed/${postId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

// Profile
export async function apiFetchProfile(userId) {
  if (userId) return await request(`/api/profile/${userId}`)
  return await request('/api/profile')
}

// Friends
export async function apiFetchFriends() {
  return await request('/api/friends')
}

// Messages
export async function apiFetchMessages() {
  return await request('/api/messages')
}

export async function apiSendMessage(friendId, text) {
  return await request(`/api/messages/${friendId}`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function apiFetchOlderMessages(friendId, offset = 0, limit = 20) {
  return await request(`/api/messages/${friendId}/older?offset=${offset}&limit=${limit}`)
}

// Facebook OAuth
export function getFacebookAuthUrl(lang) {
  return `${API_BASE}/api/auth/facebook?lang=${lang}`
}

// GDPR Compliance endpoints
export async function apiGiveConsent(consentTypes) {
  return await request('/api/gdpr/consent', {
    method: 'POST',
    body: JSON.stringify({ consent_types: consentTypes }),
  })
}

export async function apiGetConsentStatus() {
  return await request('/api/gdpr/consent')
}

export async function apiWithdrawConsent(consentType) {
  return await request('/api/gdpr/consent/withdraw', {
    method: 'POST',
    body: JSON.stringify({ consent_type: consentType }),
  })
}

export async function apiDeleteFacebookData() {
  return await request('/api/gdpr/facebook-data', { method: 'DELETE' })
}

export async function apiDeleteAccount() {
  return await request('/api/gdpr/account', { method: 'DELETE' })
}

export async function apiExportData() {
  return await request('/api/gdpr/export')
}

// Invites
export async function apiGetInviteLink() {
  return await request('/api/invites/link')
}

export async function apiGetInviteInfo(token) {
  try {
    const res = await fetch(`${API_BASE}/api/invite/${token}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function apiSendInvites(friends) {
  return await request('/api/invites', {
    method: 'POST',
    body: JSON.stringify({ friends }),
  })
}

export async function apiGetInvites() {
  return await request('/api/invites')
}

// Profile avatar
export async function apiUploadAvatar(file) {
  const form = new FormData()
  form.append('avatar', file)
  try {
    const res = await fetch(`${API_BASE}/api/profile/avatar`, {
      method: 'POST',
      headers: { 'X-Session-Id': getSessionId() },
      credentials: 'same-origin',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    if (err.message === 'Failed to fetch') return null
    throw err
  }
}
