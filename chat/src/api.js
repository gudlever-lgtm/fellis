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

export async function apiSendMessage(conversationId, text, lang = 'da') {
  const body = lang === 'en'
    ? { text_en: text, text_da: text }
    : { text_da: text, text_en: text }
  return request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
