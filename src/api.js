// API client for fellis.eu backend
// Falls back to null when the server is unavailable (demo mode uses mock data)

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers: headers() })
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

export async function apiRegister(name, email, password, lang) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, lang }),
  })
  if (data?.sessionId) {
    localStorage.setItem('fellis_session_id', data.sessionId)
  }
  return data
}

export async function apiCheckSession() {
  if (!getSessionId()) return null
  return await request('/api/auth/session')
}

export async function apiLogout() {
  await request('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem('fellis_session_id')
}

// Feed
export async function apiFetchFeed() {
  return await request('/api/feed')
}

export async function apiCreatePost(text) {
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
