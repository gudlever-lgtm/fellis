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

export async function apiToggleLike(postId, reaction) {
  return await request(`/api/feed/${postId}/like`, {
    method: 'POST',
    body: JSON.stringify({ reaction }),
  })
}

export async function apiAddComment(postId, text, mediaFile) {
  if (mediaFile) {
    const form = new FormData()
    form.append('text', text)
    form.append('media', mediaFile)
    try {
      const res = await fetch(`${API_BASE}/api/feed/${postId}/comment`, {
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

export async function apiSendFriendRequest(userId) {
  return await request(`/api/friends/request/${userId}`, { method: 'POST' })
}

export async function apiFetchFriendRequests() {
  return await request('/api/friends/requests')
}

export async function apiAcceptFriendRequest(requestId) {
  return await request(`/api/friends/requests/${requestId}/accept`, { method: 'POST' })
}

export async function apiDeclineFriendRequest(requestId) {
  return await request(`/api/friends/requests/${requestId}/decline`, { method: 'POST' })
}

export async function apiUnfriend(userId, notify = false) {
  return await request(`/api/friends/${userId}${notify ? '?notify=1' : ''}`, { method: 'DELETE' })
}

// Conversations (replaces legacy /api/messages)
export async function apiFetchConversations() {
  return await request('/api/conversations')
}

export async function apiSendConversationMessage(conversationId, text) {
  return await request(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function apiFetchOlderConversationMessages(conversationId, offset = 0, limit = 20) {
  return await request(`/api/conversations/${conversationId}/messages/older?offset=${offset}&limit=${limit}`)
}

export async function apiCreateConversation(participantIds, name = null, isGroup = false, isFamilyGroup = false) {
  return await request('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ participantIds, name, isGroup, isFamilyGroup }),
  })
}

export async function apiInviteToConversation(conversationId, userIds) {
  return await request(`/api/conversations/${conversationId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  })
}

export async function apiMuteConversation(conversationId, minutes) {
  return await request(`/api/conversations/${conversationId}/mute`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
}

export async function apiLeaveConversation(conversationId) {
  return await request(`/api/conversations/${conversationId}/leave`, { method: 'DELETE' })
}

export async function apiRenameConversation(conversationId, name) {
  return await request(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
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

// Link preview
export async function apiLinkPreview(url) {
  return await request(`/api/link-preview?url=${encodeURIComponent(url)}`)
}

// Fetch a single post by ID (for search result navigation)
export async function apiGetPost(id) {
  return await request(`/api/posts/${id}`)
}

// Search all users (for add-friends)
export async function apiSearchUsers(q) {
  return await request(`/api/users/search?q=${encodeURIComponent(q)}`)
}

// Search (posts and messages the user is involved in)
export async function apiSearch(q) {
  return await request(`/api/search?q=${encodeURIComponent(q)}`)
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

// ── Marketplace ──
export async function apiFetchListings({ category = '', location = '', q = '' } = {}) {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (location) params.set('location', location)
  if (q) params.set('q', q)
  return await request(`/api/marketplace?${params}`)
}

export async function apiFetchMyListings() {
  return await request('/api/marketplace/mine')
}

export async function apiCreateListing(formData) {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace`, {
      method: 'POST',
      headers: { 'X-Session-Id': getSessionId() },
      credentials: 'same-origin',
      body: formData,
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

export async function apiUpdateListing(id, data) {
  return await request(`/api/marketplace/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function apiMarkListingSold(id) {
  return await request(`/api/marketplace/${id}/sold`, { method: 'POST' })
}

export async function apiDeleteListing(id) {
  return await request(`/api/marketplace/${id}`, { method: 'DELETE' })
}

export async function apiBoostListing(id) {
  return await request(`/api/marketplace/${id}/boost`, { method: 'POST' })
}

// ── Admin ──
export async function apiGetAdminSettings() {
  return await request('/api/admin/settings')
}

export async function apiSaveAdminSettings(data) {
  return await request('/api/admin/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
