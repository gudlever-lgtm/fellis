const BASE = import.meta.env.VITE_API_URL || '/api'

function getSessionId() {
  return localStorage.getItem('fellis_session_id')
}

function headers() {
  const sid = getSessionId()
  return {
    'Content-Type': 'application/json',
    ...(sid ? { 'X-Session-Id': sid } : {}),
  }
}

function formHeaders() {
  const sid = getSessionId()
  return sid ? { 'X-Session-Id': sid } : {}
}

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
      credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: body.error || res.statusText, status: res.status }
    }
    return await res.json()
  } catch {
    return null
  }
}

export async function apiCheckSession() {
  return request('/auth/session')
}

export async function apiLogin(email, password, lang = 'da') {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, lang }),
  })
}

export async function apiLogout() {
  return request('/auth/logout', { method: 'POST' })
}

export async function apiGetConversations() {
  return request('/conversations')
}

export async function apiGetMessages(conversationId) {
  return request(`/conversations/${conversationId}/messages`)
}

export async function apiSendMessage(conversationId, text, media, lang = 'da') {
  const body = {}
  if (text) {
    if (lang === 'en') { body.text_en = text; body.text_da = text }
    else { body.text_da = text; body.text_en = text }
    body.text = text
  }
  if (media?.length) body.media = media
  return request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function apiUploadFile(file) {
  const form = new FormData()
  form.append('file', file)
  form.append('type', 'message')
  try {
    const res = await fetch(`${BASE}/upload/file`, {
      method: 'POST',
      headers: formHeaders(),
      credentials: 'include',
      body: form,
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function apiRenameConversation(conversationId, name) {
  return request(`/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function apiLeaveConversation(conversationId) {
  return request(`/conversations/${conversationId}/leave`, { method: 'DELETE' })
}

export async function apiMuteConversation(conversationId, minutes) {
  return request(`/conversations/${conversationId}/mute`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
}

export async function apiAddParticipants(conversationId, userIds) {
  return request(`/conversations/${conversationId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  })
}

export async function apiRemoveParticipant(conversationId, userId) {
  return request(`/conversations/${conversationId}/participants/${userId}`, { method: 'DELETE' })
}

export async function apiMuteParticipant(conversationId, userId, minutes) {
  return request(`/conversations/${conversationId}/participants/${userId}/mute`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
}

export async function apiSearchUsers(q) {
  return request(`/users/search?q=${encodeURIComponent(q)}`)
}

export async function apiFetchFriends() {
  return request('/friends')
}
