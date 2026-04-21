// API client for fellis.eu backend
// Falls back to null when the server is unavailable (demo mode uses mock data)
// Session ID now uses HTTP-only cookies (fellis_sid) — no longer in localStorage

import { enqueuePost, processQueue, installAutoFlush } from './uploadQueue.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

function getCsrfToken() {
  return localStorage.getItem('fellis_csrf_token')
}

function getSessionId() {
  // Session ID is now in HTTP-only cookie (fellis_sid), sent automatically by browser
  // This function kept for backward compatibility with SSE endpoint
  return localStorage.getItem('fellis_session_id') || ''
}

function headers() {
  const h = { 'Content-Type': 'application/json' }
  // Session ID is now automatically sent via HTTP-only cookie (fellis_sid)
  // No need to manually send X-Session-Id header
  const csrf = getCsrfToken()
  if (csrf) h['X-CSRF-Token'] = csrf
  return h
}

// For FormData/multipart requests: CSRF token if available
// Session cookie is automatically included by browser
function formHeaders() {
  const csrf = getCsrfToken()
  return csrf ? { 'X-CSRF-Token': csrf } : {}
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
      console.warn(`API ${path} → ${res.status}`, body.error || '')
      return null
    }
    return await res.json()
  } catch (err) {
    if (err.message === 'Failed to fetch') return null // Server not running
    throw err
  }
}

// Auth
export async function apiLogin(email, password, lang) {
  // Use raw fetch so non-ok responses can return their error body to the UI
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: JSON.stringify({ email, password, lang }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { error: body.error || 'invalid_credentials', status: res.status }
    return body
  } catch {
    return null
  }
}

export async function apiRegister(name, email, password, lang, inviteToken) {
  // Use raw fetch so non-ok responses can return their error body to the UI
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: JSON.stringify({ name, email, password, lang, inviteToken: inviteToken || undefined }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { error: body.error || 'registration_failed' }
    return body
  } catch {
    return null
  }
}

export async function apiForgotPassword(email, lang) {
  // Use raw fetch so rate-limit (429) and other errors can be surfaced to the UI
  try {
    const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: JSON.stringify({ email, lang }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { error: body.error || 'request_failed', status: res.status }
    return body
  } catch {
    return null
  }
}

export async function apiResetPassword(token, password, lang) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: JSON.stringify({ token, password, lang }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { error: body.error || 'reset_failed', status: res.status }
    return body
  } catch {
    return null
  }
}

export async function apiVerifyMfa(userId, code, lang) {
  const data = await request('/api/auth/verify-mfa', {
    method: 'POST',
    body: JSON.stringify({ userId, code, lang }),
  })
  // Session ID now stored in HTTP-only cookie by server
  return data
}

export async function apiSendEnableMfa() {
  return await request('/api/auth/send-enable-mfa', { method: 'POST' })
}

export async function apiConfirmEnableMfa(code) {
  return await request('/api/auth/confirm-enable-mfa', { method: 'POST', body: JSON.stringify({ code }) })
}

export async function apiEnableMfa() {
  return await request('/api/auth/enable-mfa', { method: 'POST' })
}

export async function apiDisableMfa() {
  return await request('/api/auth/disable-mfa', { method: 'POST' })
}

export async function apiSendSettingsMfa() {
  return await request('/api/auth/send-settings-mfa', { method: 'POST' })
}

export async function apiGetAdminMfaUsers() {
  return await request('/api/admin/mfa-users')
}

export async function apiAdminForceDisableMfa(userId) {
  return await request(`/api/admin/users/${userId}/force-disable-mfa`, { method: 'POST' })
}

export async function apiUpdatePhone(phone) {
  return await request('/api/profile/phone', {
    method: 'PATCH',
    body: JSON.stringify({ phone }),
  })
}

export async function apiCheckSession() {
  // Use raw fetch so we can distinguish auth failures (401/403) from network errors.
  // request() returns null for both, but only auth failures should clear the session.
  try {
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: headers(),
      credentials: 'same-origin',
    })
    if (res.status === 401 || res.status === 403) return { __authError: true }
    if (!res.ok) return null // server error — treat as network issue, keep session
    return await res.json()
  } catch {
    return null // network unreachable — keep session
  }
}

// Get CSRF token for authenticated requests
export async function apiGetCsrfToken() {
  return await request('/api/csrf-token', { method: 'GET' })
}

export async function apiLogout() {
  await request('/api/auth/logout', { method: 'POST' })
  // Session cookie automatically managed by browser
}

// Onboarding
export async function apiDismissOnboarding() {
  return await request('/api/user/onboarding/dismiss', { method: 'POST' })
}

// Feed
export async function apiFetchFeed(cursor = null, limit = 20, mode = null, opts = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  if (mode) params.set('mode', mode)
  if (opts.ranked) params.set('ranked', '1')
  if (opts.offset) params.set('offset', String(opts.offset))
  return await request(`/api/feed?${params}`)
}

export async function apiPreflightPost(text) {
  return await request('/api/feed/preflight', { method: 'POST', body: JSON.stringify({ text }) })
}

export async function apiFetchMemories() {
  return await request('/api/feed/memories')
}

export async function apiGetDiscovery() {
  return await request('/api/feed/discovery')
}

// Single XHR upload attempt. Uses a stall-based inactivity timer (2 min
// without any progress) instead of a wall-clock timeout, so slow-but-
// steady uploads on mobile connections are not killed prematurely.
function uploadPostOnce(payload, onProgress) {
  const { text, files, schedAt, categories, location, taggedUsers, linkedContent } = payload
  const total = files.reduce((sum, f) => sum + f.size, 0)
  const STALL_MS = 2 * 60 * 1000

  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('text', text || '')
    if (schedAt) form.append('scheduled_at', schedAt)
    if (categories?.length) form.append('categories', JSON.stringify(categories))
    const locName = location?.place_name || location?.name
    const locLat = location?.geo_lat ?? location?.lat
    const locLng = location?.geo_lng ?? location?.lng
    if (locName) form.append('place_name', locName)
    if (locLat != null) form.append('geo_lat', locLat)
    if (locLng != null) form.append('geo_lng', locLng)
    if (taggedUsers?.length) form.append('tagged_users', JSON.stringify(taggedUsers))
    if (linkedContent?.type) { form.append('linked_type', linkedContent.type); form.append('linked_id', linkedContent.id) }
    for (const file of files) form.append('media', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/feed`, true)
    xhr.withCredentials = true
    const csrf = getCsrfToken()
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf)

    let stallTimer = null
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        try { xhr.abort() } catch { /* ignore */ }
        const err = new Error('Upload stalled')
        err.code = 'TIMEOUT'
        reject(err)
      }, STALL_MS)
    }
    const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null } }

    resetStall()
    xhr.upload.onprogress = (e) => {
      resetStall()
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total, phase: 'upload' })
      }
    }
    xhr.upload.onload = () => {
      if (onProgress) onProgress({ loaded: total, total, phase: 'processing' })
    }
    xhr.onerror = () => {
      clearStall()
      const err = new Error('Network error — could not reach server')
      err.code = 'NETWORK_ERROR'
      reject(err)
    }
    xhr.onabort = () => {
      clearStall()
      // onabort fires for our own stall-abort too; reject() above already ran,
      // so this rejection is a no-op in that case.
      const err = new Error('Upload cancelled')
      err.code = 'ABORTED'
      reject(err)
    }
    xhr.onload = () => {
      clearStall()
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)) }
        catch { resolve(null) }
      } else {
        let body = {}
        try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
        const err = new Error(body.error || `HTTP ${xhr.status}`)
        err.status = xhr.status
        // 4xx (except 408/429) are permanent — don't retry
        err.code = (xhr.status >= 500 || xhr.status === 408 || xhr.status === 429) ? 'NETWORK_ERROR' : 'HTTP_ERROR'
        reject(err)
      }
    }
    xhr.send(form)
  })
}

// Uploads a post with stall-based timeout + exponential-backoff retry.
// Throws on final failure; the caller decides whether to enqueue.
export async function uploadPostResilient(payload, onProgress) {
  const MAX_ATTEMPTS = 3
  let lastErr = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Wait until the browser reports it's online before each attempt
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const err = new Error('Offline')
      err.code = 'NETWORK_ERROR'
      throw err
    }
    try {
      return await uploadPostOnce(payload, onProgress)
    } catch (err) {
      lastErr = err
      if (err.code !== 'NETWORK_ERROR' && err.code !== 'TIMEOUT') throw err
      if (attempt === MAX_ATTEMPTS) throw err
      // exponential backoff: 2s, 4s
      const delay = 1000 * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// Install the auto-flusher once (fires on 'online', visibility change, etc.)
if (typeof window !== 'undefined') {
  installAutoFlush((payload) => uploadPostResilient(payload))
}

export async function apiCreatePost(text, mediaFiles, scheduledAt, categories, location, taggedUsers, linkedContent, onProgress, linkedServiceId) {
  if (mediaFiles?.length) {
    // Pre-flight: validate file sizes client-side (50MB per file, 200MB total)
    const MAX_FILE = 50 * 1024 * 1024
    const MAX_TOTAL = 200 * 1024 * 1024
    let total = 0
    for (const f of mediaFiles) {
      if (f.size > MAX_FILE) {
        const err = new Error(`File "${f.name}" is too large (max 50 MB)`)
        err.code = 'FILE_TOO_LARGE'
        throw err
      }
      total += f.size
    }
    if (total > MAX_TOTAL) {
      const err = new Error('Total upload size exceeds 200 MB')
      err.code = 'FILE_TOO_LARGE'
      throw err
    }
    const payload = {
      text, files: mediaFiles, schedAt: scheduledAt,
      categories, location, taggedUsers, linkedContent,
    }
    try {
      return await uploadPostResilient(payload, onProgress)
    } catch (err) {
      // If the failure is network-related, persist the upload to IndexedDB
      // so it can be retried later (e.g. when the user reaches WiFi).
      if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') {
        try {
          const queueId = await enqueuePost(payload)
          // Trigger a processing attempt immediately — it's a no-op if offline.
          setTimeout(() => processQueue((p) => uploadPostResilient(p)), 0)
          return { queued: true, queueId }
        } catch {
          // IndexedDB unavailable — surface the original error
          throw err
        }
      }
      throw err
    }
  }
  return await request('/api/feed', {
    method: 'POST',
    body: JSON.stringify({
      text,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(categories?.length ? { categories } : {}),
      ...(location ? { place_name: location.place_name || location.name, geo_lat: location.geo_lat ?? location.lat, geo_lng: location.geo_lng ?? location.lng } : {}),
      ...(taggedUsers?.length ? { tagged_users: taggedUsers } : {}),
      ...(linkedContent?.type && linkedContent.type !== 'service' ? { linked_type: linkedContent.type, linked_id: linkedContent.id } : {}),
      ...(linkedContent?.type === 'service' || linkedServiceId ? { linked_service_id: linkedContent?.id ?? linkedServiceId } : {}),
    }),
  })
}

export async function apiGetLinkedContent(type, id) {
  return await request(`/api/linked-content?type=${encodeURIComponent(type)}&id=${id}`)
}

export async function apiGetPostLikers(postId) {
  return await request(`/api/feed/${postId}/likers`)
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
        headers: formHeaders(),
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

export async function apiLikeComment(commentId, emoji = '❤️') {
  return await request(`/api/comments/${commentId}/like`, { method: 'POST', body: JSON.stringify({ emoji }) })
}

export async function apiDeletePost(postId) {
  return await request(`/api/feed/${postId}`, { method: 'DELETE' })
}

export async function apiEditPost(postId, text) {
  return await request(`/api/feed/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

// Profile
export async function apiFetchProfile(userId) {
  if (userId) return await request(`/api/profile/${userId}`)
  return await request('/api/profile')
}
export async function apiFetchProfilePhotos(userId) {
  return await request(`/api/profile/${userId}/photos`)
}

export async function apiFetchUserPosts(userId) {
  return await request(`/api/profile/${userId}/posts`)
}
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

export async function apiCancelFriendRequest(userId) {
  return await request(`/api/friends/request/${userId}`, { method: 'DELETE' })
}

export async function apiUnfriend(userId, notify = false) {
  return await request(`/api/friends/${userId}${notify ? '?notify=1' : ''}`, { method: 'DELETE' })
}

export async function apiToggleFamilyFriend(userId, isFamily) {
  return await request(`/api/friends/${userId}/family`, {
    method: 'PATCH',
    body: JSON.stringify({ is_family: isFamily }),
  })
}

export async function apiFetchFriendSuggestions() {
  return await request('/api/friends/suggested')
}

// User follows (asymmetric: follow any user or company)
export async function apiFollowUser(userId) {
  return await request(`/api/users/${userId}/follow`, { method: 'POST' })
}

export async function apiUnfollowUser(userId) {
  return await request(`/api/users/${userId}/follow`, { method: 'DELETE' })
}

export async function apiGetFollowers() {
  return await request('/api/me/followers')
}

export async function apiGetFollowing() {
  return await request('/api/me/following')
}

// Conversations (replaces legacy /api/messages)
export async function apiFetchConversations() {
  return await request('/api/conversations')
}

export async function apiMarkConversationRead(conversationId) {
  return await request(`/api/conversations/${conversationId}/read`, { method: 'POST' })
}

export async function apiSendConversationMessage(conversationId, text, media = null) {
  const body = { text }
  if (media?.length) body.media = media
  return await request(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
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

export async function apiRemoveConversationParticipant(conversationId, userId) {
  return await request(`/api/conversations/${conversationId}/participants/${userId}`, { method: 'DELETE' })
}

export async function apiMuteConversationParticipant(conversationId, userId, minutes) {
  return await request(`/api/conversations/${conversationId}/participants/${userId}/mute`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
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

export async function apiRequestAccountDelete(password) {
  return await request('/api/gdpr/account/request-delete', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function apiDeleteAccount({ password, smsCode } = {}) {
  return await request('/api/gdpr/account', {
    method: 'DELETE',
    body: JSON.stringify({ password, sms_code: smsCode }),
  })
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

export async function apiCancelInvite(id) {
  return await request(`/api/invites/${id}`, { method: 'DELETE' })
}

export async function apiFeedCompanyPosts() {
  return await request('/api/feed/company-posts')
}

// Events
export async function apiFetchEvents() {
  return await request('/api/events')
}

export async function apiCreateEvent(data) {
  return await request('/api/events', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiRsvpEvent(eventId, status, extras = {}) {
  return await request(`/api/events/${eventId}/rsvp`, {
    method: 'PUT',
    body: JSON.stringify({ status, dietary: extras.dietary || null, plusOne: extras.plusOne || false }),
  })
}

export async function apiUpdateEvent(eventId, data) {
  return await request(`/api/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiDeleteEvent(eventId) {
  return await request(`/api/events/${eventId}`, { method: 'DELETE' })
}

// SSE — Server-Sent Events for real-time updates.
// Returns a controller object with { onmessage, close } so callers can attach
// a message handler and close the connection.  Internally uses exponential
// backoff (max ~60 s) so a temporary server restart does not spam the browser
// console with a "can't establish connection" error every 3 seconds.
export function openSSE() {
  let es = null
  let closed = false
  let delay = 2000
  let timer = null
  const ctrl = { onmessage: null, onreconnect: null }
  let connected = false

  function connect() {
    if (closed) return
    const sid = getSessionId()
    if (!sid) return // not logged in — nothing to connect to
    const url = `${API_BASE}/api/sse?sid=${encodeURIComponent(sid)}`
    es = new EventSource(url)
    es.onmessage = (e) => { if (ctrl.onmessage) ctrl.onmessage(e) }
    es.onopen = () => {
      delay = 2000 // reset backoff on successful connect
      if (connected && ctrl.onreconnect) ctrl.onreconnect() // fired on reconnect (not first connect)
      connected = true
    }
    es.onerror = () => {
      es.close()
      es = null
      if (!closed) {
        timer = setTimeout(() => { delay = Math.min(delay * 2, 64000); connect() }, delay)
      }
    }
  }

  ctrl.close = () => {
    closed = true
    clearTimeout(timer)
    es?.close()
  }

  connect()
  return ctrl
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
      headers: formHeaders(),
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
export async function apiFetchListings({ category = '', location = '', q = '', limit, offset } = {}) {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (location) params.set('location', location)
  if (q) params.set('q', q)
  if (limit != null) params.set('limit', String(limit))
  if (offset != null) params.set('offset', String(offset))
  return await request(`/api/marketplace?${params}`)
}

export async function apiFetchMyListings() {
  return await request('/api/marketplace/mine')
}

export async function apiCreateListing(formData) {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace`, {
      method: 'POST',
      headers: formHeaders(),
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

export async function apiUpdateListing(id, formData) {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/${id}`, {
      method: 'PUT',
      headers: formHeaders(),
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

export async function apiMarkListingSold(id) {
  return await request(`/api/marketplace/${id}/sold`, { method: 'POST' })
}

export async function apiDeleteListing(id) {
  return await request(`/api/marketplace/${id}`, { method: 'DELETE' })
}

export async function apiBoostListing(id) {
  return await request(`/api/marketplace/${id}/boost`, { method: 'POST' })
}

export async function apiGetBoostedFeedListings() {
  return await request('/api/marketplace/boosted-feed')
}

export async function apiGetMarketplaceStats() {
  return await request('/api/marketplace/stats')
}

export async function apiGetMarketplaceCategories() {
  return await request('/api/marketplace/categories')
}

export async function apiRelistListing(id) {
  return await request(`/api/marketplace/${id}/relist`, { method: 'POST' })
}

export async function apiRecordListingView(id) {
  return await request(`/api/marketplace/${id}/view`, { method: 'POST' })
}

// ── Marketplace keyword alerts ──
export async function apiGetMarketplaceAlerts() {
  return await request('/api/me/marketplace-alerts')
}
export async function apiCreateMarketplaceAlert(keyword) {
  return await request('/api/me/marketplace-alerts', { method: 'POST', body: JSON.stringify({ keyword }) })
}
export async function apiUpdateMarketplaceAlert(id, keyword) {
  return await request(`/api/me/marketplace-alerts/${id}`, { method: 'PUT', body: JSON.stringify({ keyword }) })
}
export async function apiDeleteMarketplaceAlert(id) {
  return await request(`/api/me/marketplace-alerts/${id}`, { method: 'DELETE' })
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

export async function apiGetAdminStorageStats() {
  return await request('/api/admin/storage-stats')
}

export async function apiRevealAdminKey(keyName, password) {
  return await request('/api/admin/settings/reveal-key', {
    method: 'POST',
    body: JSON.stringify({ key_name: keyName, password }),
  })
}

export async function apiGetLivestreamStatus() {
  return await request('/api/livestream/status')
}

export async function apiGetStreamKey() {
  return await request('/api/me/stream-key')
}

export async function apiRegenerateStreamKey() {
  return await request('/api/me/stream-key/regenerate', { method: 'POST' })
}

export async function apiGetLivestreamSettings() {
  return await request('/api/admin/livestream/settings')
}

export async function apiGetLivestreamStats() {
  return await request('/api/admin/livestream/stats')
}

export async function apiSaveLivestreamSettings(data) {
  return await request('/api/admin/livestream/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiGetAdminEnvStatus() {
  return await request('/api/admin/env-status')
}

export async function apiGetInterestCategories() {
  return await request('/api/interest-categories')
}
export async function apiAdminGetInterestCategories() {
  return await request('/api/admin/interest-categories')
}
export async function apiAdminCreateInterestCategory(data) {
  return await request('/api/admin/interest-categories', { method: 'POST', body: JSON.stringify(data) })
}
export async function apiAdminUpdateInterestCategory(id, data) {
  return await request(`/api/admin/interest-categories/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiAdminDeleteInterestCategory(id) {
  return await request(`/api/admin/interest-categories/${id}`, { method: 'DELETE' })
}
export async function apiAdminReorderInterestCategories(order) {
  return await request('/api/admin/interest-categories/reorder', { method: 'PATCH', body: JSON.stringify({ order }) })
}

export async function apiAdminNotifyAll(messageDa, messageEn, target = 'all') {
  return await request('/api/admin/notify-all', { method: 'POST', body: JSON.stringify({ message_da: messageDa, message_en: messageEn, target }) })
}

export async function apiGetAdminStats() {
  return await request('/api/admin/stats')
}

// ── User moderator request ────────────────────────────────────────────────────
export async function apiGetMyModeratorRequest() {
  return await request('/api/moderation/my-request')
}
export async function apiRequestModeratorStatus(reason) {
  return await request('/api/moderation/request', { method: 'POST', body: JSON.stringify({ reason }) })
}
export async function apiWithdrawModeratorRequest() {
  return await request('/api/moderation/request', { method: 'DELETE' })
}

export async function apiGetAnalytics(days = 30) {
  return await request(`/api/analytics?days=${days}`)
}

export async function apiGetVisitorStats(days = 30) {
  return await request(`/api/analytics/visitor-stats?days=${days}`)
}

export async function apiTrackVisit() {
  return await request('/api/visit', { method: 'POST' })
}

export async function apiUpdateMode(mode) {
  return await request('/api/me/mode', { method: 'PATCH', body: JSON.stringify({ mode }) })
}

export async function apiUpdatePlan(plan) {
  return await request('/api/me/plan', { method: 'PATCH', body: JSON.stringify({ plan }) })
}

export async function apiUpdateInterests(interests) {
  return await request('/api/me/interests', { method: 'PATCH', body: JSON.stringify({ interests }) })
}

export async function apiUpdateTags(tags) {
  return await request('/api/me/tags', { method: 'PATCH', body: JSON.stringify({ tags }) })
}

export async function apiUpdateProfileExtended(data) {
  return await request('/api/me/profile-extended', { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiGetFeedWeights() {
  return await request('/api/admin/feed-weights')
}

export async function apiSaveFeedWeights(weights) {
  return await request('/api/admin/feed-weights', { method: 'POST', body: JSON.stringify(weights) })
}

export async function apiGetInterestStats() {
  return await request('/api/admin/interest-stats')
}

// ── Viral Growth ──

export async function apiGetReferralDashboard() {
  return await request('/api/referrals/dashboard')
}

export async function apiGetLeaderboard() {
  return await request('/api/referrals/leaderboard')
}

export async function apiGetBadges() {
  return await request('/api/badges')
}

export async function apiGeocode(q, lang = 'da') {
  return await request(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`)
}

export async function apiReverseGeocode(lat, lng, lang = 'da') {
  return await request(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&lang=${lang}`)
}

export async function apiGetPublicProfile(handle) {
  try {
    const res = await fetch(`${API_BASE}/api/public/profile/${encodeURIComponent(handle)}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function apiGetPublicPost(shareToken) {
  try {
    const res = await fetch(`${API_BASE}/api/public/post/${shareToken}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function apiGeneratePostShareToken(postId) {
  return await request(`/api/posts/${postId}/share-token`, { method: 'POST' })
}

export async function apiRevokePostShareToken(postId) {
  return await request(`/api/posts/${postId}/share-token`, { method: 'DELETE' })
}

export async function apiToggleProfilePublic(isPublic) {
  return await request('/api/profile/public', {
    method: 'PATCH',
    body: JSON.stringify({ isPublic }),
  })
}

export async function apiTrackShare(shareType, targetId, platform) {
  return await request('/api/share/track', {
    method: 'POST',
    body: JSON.stringify({ shareType, targetId, platform }),
  })
}

export async function apiGetAdminViralStats(days = 30) {
  return await request(`/api/admin/viral-stats?days=${days}`)
}

// ── Group Suggestions ──

export async function apiGetGroupSuggestions() {
  return await request('/api/groups/suggestions')
}

export async function apiJoinGroup(groupId) {
  return await request(`/api/groups/${groupId}/join`, { method: 'POST' })
}

// ── Reels ──
export async function apiFetchReels(offset = 0, limit = 10) {
  return await request(`/api/reels?offset=${offset}&limit=${limit}`)
}

export async function apiUploadReel(videoFile, caption, taggedUsers) {
  const form = new FormData()
  form.append('video', videoFile)
  if (caption) form.append('caption', caption)
  if (taggedUsers?.length) form.append('tagged_users', JSON.stringify(taggedUsers))
  try {
    const res = await fetch(`${API_BASE}/api/reels`, {
      method: 'POST',
      headers: formHeaders(),
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

export async function apiToggleReelLike(id, reaction = '❤️') {
  return await request(`/api/reels/${id}/like`, { method: 'POST', body: JSON.stringify({ reaction }) })
}

export async function apiFetchReelComments(id) {
  return await request(`/api/reels/${id}/comments`)
}

export async function apiAddReelComment(id, text) {
  return await request(`/api/reels/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function apiDeleteReel(id) {
  return await request(`/api/reels/${id}`, { method: 'DELETE' })
}

export async function apiShareReel(id) {
  return await request(`/api/reels/${id}/share`, { method: 'POST' })
}

// ── Calendar ──

export async function apiFetchCalendarEvents() {
  return await request('/api/calendar/events')
}

export async function apiFetchCalendarReminders() {
  return await request('/api/calendar/reminders')
}

export async function apiCreateCalendarReminder(date, title, note) {
  return await request('/api/calendar/reminders', { method: 'POST', body: JSON.stringify({ date, title, note }) })
}

export async function apiDeleteCalendarReminder(id) {
  return await request(`/api/calendar/reminders/${id}`, { method: 'DELETE' })
}

export async function apiUpdateBirthday(birthday) {
  return await request('/api/profile/birthday', { method: 'PATCH', body: JSON.stringify({ birthday }) })
}

// ── Misc platform ──

export async function apiHeartbeat() {
  return await request('/api/me/heartbeat', { method: 'POST' })
}

export async function apiUpdateProfile(data) {
  return await request('/api/profile', { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiGetConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function apiGetChangelog(lang = 'da') {
  return await request(`/api/changelog?lang=${lang}`)
}

export async function apiSubmitFeedback(type, title, description) {
  return await request('/api/feedback', { method: 'POST', body: JSON.stringify({ type, title, description }) })
}

export async function apiGetAdminFeedback(status = null) {
  return await request('/api/admin/feedback' + (status ? `?status=${encodeURIComponent(status)}` : ''))
}

export async function apiUpdateFeedbackStatus(id, status, admin_note) {
  return await request(`/api/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status, admin_note }) })
}

export async function apiGetNotifications() {
  return await request('/api/notifications')
}

export async function apiGetNotificationCount() {
  return await request('/api/notifications/unread-count')
}

export async function apiTestNotification() {
  return await request('/api/notifications/test', { method: 'POST' })
}

export async function apiMarkNotificationRead(id) {
  return await request(`/api/notifications/${id}/read`, { method: 'POST' })
}

export async function apiMarkAllNotificationsRead() {
  return await request('/api/notifications/read-all', { method: 'POST' })
}

export async function apiGetNotificationPreferences() {
  return await request('/api/me/notification-preferences')
}

export async function apiSaveNotificationPreferences(prefs) {
  return await request('/api/me/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify({ prefs }),
  })
}

export async function apiSuggestCategory(text) {
  const safe = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return await request(`/api/feed/suggest-category?text=${encodeURIComponent(safe)}`)
}

export async function apiGetMyJobs() {
  return await request('/api/jobs/mine')
}
export async function apiFetchJobs({ q = '', location = '', type = '' } = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (location) params.set('location', location)
  if (type) params.set('type', type)
  return await request(`/api/jobs?${params}`)
}

// ── Post insights ──

export async function apiGetPostInsights(postId) {
  return await request(`/api/posts/${postId}/insights`)
}

// ── Moderation ──

export async function apiBlockUser(userId) {
  return await request(`/api/users/${userId}/block`, { method: 'POST' })
}

export async function apiUnblockUser(userId) {
  return await request(`/api/users/${userId}/block`, { method: 'DELETE' })
}

export async function apiGetMyBlocks() {
  return await request('/api/me/blocks')
}

export async function apiReportContent(targetType, targetId, reason, details = '') {
  return await request('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }),
  })
}

export async function apiGetModerationQueue() {
  return await request('/api/admin/moderation/queue')
}

export async function apiDismissReport(reportId, reason = '') {
  return await request(`/api/admin/moderation/reports/${reportId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function apiModerateRemoveContent(type, targetId, reportId = null, reason = '') {
  return await request('/api/admin/moderation/content/remove', {
    method: 'POST',
    body: JSON.stringify({ type, target_id: targetId, report_id: reportId, reason }),
  })
}

export async function apiWarnUser(userId, reason = '', reportId = null) {
  return await request(`/api/admin/moderation/users/${userId}/warn`, {
    method: 'POST',
    body: JSON.stringify({ reason, report_id: reportId }),
  })
}

export async function apiSuspendUser(userId, days = 7, reason = '', reportId = null) {
  return await request(`/api/admin/moderation/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ days, reason, report_id: reportId }),
  })
}

export async function apiBanUser(userId, reason = '', reportId = null) {
  return await request(`/api/admin/moderation/users/${userId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ reason, report_id: reportId }),
  })
}

export async function apiUnbanUser(userId) {
  return await request(`/api/admin/moderation/users/${userId}/unban`, { method: 'POST' })
}

export async function apiGetModerationUsers(q = '') {
  return await request(`/api/admin/moderation/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
}

export async function apiGetKeywordFilters() {
  return await request('/api/admin/moderation/keywords')
}

export async function apiAddKeywordFilter(keyword, action = 'flag', category = 'other', notes = '') {
  return await request('/api/admin/moderation/keywords', {
    method: 'POST',
    body: JSON.stringify({ keyword, action, category, notes: notes || undefined }),
  })
}

export async function apiUpdateKeywordFilter(id, keyword, action, category, notes = '') {
  return await request(`/api/admin/moderation/keywords/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ keyword, action, category, notes: notes || undefined }),
  })
}

export async function apiDeleteKeywordFilter(id) {
  return await request(`/api/admin/moderation/keywords/${id}`, { method: 'DELETE' })
}

export async function apiGetModerationActions() {
  return await request('/api/admin/moderation/actions')
}

export async function apiGetModeratorCandidates() {
  return await request('/api/admin/moderation/candidates')
}

export async function apiUpdateModeratorCandidate(id, isCandidate, note) {
  return await request(`/api/admin/moderation/users/${id}/candidate`, {
    method: 'PATCH',
    body: JSON.stringify({ is_candidate: isCandidate, note }),
  })
}

// ── Moderator management (admin) ──
export async function apiGetModerators() {
  return await request('/api/admin/moderators')
}
export async function apiGrantModerator(userId) {
  return await request(`/api/admin/moderators/${userId}/grant`, { method: 'POST' })
}
export async function apiRevokeModerator(userId) {
  return await request(`/api/admin/moderators/${userId}/revoke`, { method: 'POST' })
}

// Aliases used by Moderators admin tab
export async function apiGetModeratorRequests() {
  return await request('/api/admin/moderation/candidates')
}
export async function apiApproveModeratorRequest(id) {
  return await request(`/api/admin/moderators/${id}/grant`, { method: 'POST' })
}
export async function apiDenyModeratorRequest(id, reason) {
  return await request(`/api/admin/moderation/users/${id}/candidate`, {
    method: 'PATCH',
    body: JSON.stringify({ is_candidate: false, note: reason }),
  })
}

// ── Ads ──────────────────────────────────────────────────────────────────────
export async function apiCreateAd(data) {
  return await request('/api/ads', { method: 'POST', body: JSON.stringify(data) })
}
export async function apiGetMyAds() {
  return await request('/api/ads/mine')
}
export async function apiGetAd(id) {
  return await request(`/api/ads/${id}`)
}
export async function apiUpdateAd(id, data) {
  return await request(`/api/ads/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiPatchAd(id, data) {
  return await request(`/api/ads/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}
export async function apiDeleteAd(id) {
  return await request(`/api/ads/${id}`, { method: 'DELETE' })
}
export async function apiPayForAd(id) {
  return await request(`/api/ads/${id}/pay`, { method: 'POST' })
}
export async function apiBoostPost(postId) {
  return await request(`/api/posts/${postId}/boost`, { method: 'POST' })
}
export async function apiTrackAdImpression(id) {
  return await request(`/api/ads/${id}/impression`, { method: 'POST' })
}
export async function apiTrackAdClick(id) {
  return await request(`/api/ads/${id}/click`, { method: 'POST' })
}
export async function apiRecordAdImpression(id) {
  return await request(`/api/content/${id}/view`, { method: 'POST' })
}
export async function apiRecordAdClick(id) {
  return await request(`/api/content/${id}/open`, { method: 'POST' })
}
export async function apiServeAds(placement) {
  return await request(`/api/content?section=${placement}`)
}

// ── Subscription ──────────────────────────────────────────────────────────────
export async function apiGetSubscription() {
  return await request('/api/me/subscription')
}

// ── Currency conversion ────────────────────────────────────────────────────────
export async function apiGetEurDkkRate() {
  return await request('/api/currency/eur-dkk')
}

// ── Mollie payments ───────────────────────────────────────────────────────────
export async function apiCreateMolliePayment(plan, amount, currency, adId, recurring = false, interval = 'monthly') {
  const body = { plan, recurring: !!recurring }
  if (recurring) body.interval = interval
  if (amount != null) body.amount = parseFloat(amount).toFixed(2)
  if (currency) body.currency = currency
  if (adId) body.ad_id = adId
  return await request('/api/mollie/payment/create', { method: 'POST', body: JSON.stringify(body) })
}
export async function apiCancelMollieSubscription() {
  return await request('/api/mollie/subscription/cancel', { method: 'DELETE' })
}
export async function apiGetAdminStatDetail(type) {
  return await request(`/api/admin/stats/list?type=${type}`)
}
export async function apiGetMollieStatus() {
  return await request('/api/mollie/payment/status')
}

// ── Admin ad settings ─────────────────────────────────────────────────────────
export async function apiGetAdminAdStats() {
  return await request('/api/admin/ad-stats')
}
export async function apiGetAdPrice() {
  return await request('/api/ads/price')
}
export async function apiGetPublicPricing() {
  return await request('/api/pricing')
}
export async function apiGetAdminAdSettings() {
  return await request('/api/admin/ad-settings')
}
export async function apiSaveAdminAdSettings(settings) {
  return await request('/api/admin/ad-settings', { method: 'PUT', body: JSON.stringify(settings) })
}

export async function apiUploadFile(file, type = 'post') {
  const form = new FormData()
  form.append('file', file)
  form.append('type', type)
  try {
    const res = await fetch(`${API_BASE}/api/upload/file`, {
      method: 'POST',
      headers: formHeaders(),
      credentials: 'same-origin',
      body: form,
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// ── Job Applications ──────────────────────────────────────────────────────────
export async function apiApplyToJob(jobId, { name, email, message }, cvFile) {
  const form = new FormData()
  form.append('name', name)
  form.append('email', email)
  if (message) form.append('message', message)
  if (cvFile) form.append('cv', cvFile)
  try {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: formHeaders(),
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

export async function apiGetJobApplications(jobId) {
  return await request(`/api/jobs/${jobId}/applications`)
}

export async function apiUpdateJobApplication(jobId, appId, status) {
  return await request(`/api/jobs/${jobId}/applications/${appId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function apiTrackJob(jobId, status) {
  return await request(`/api/jobs/${jobId}/track`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function apiGetTrackedJobs() {
  return await request('/api/jobs/tracked')
}

export async function apiShareJob(jobId, userId) {
  return await request(`/api/jobs/${jobId}/share`, { method: 'POST', body: JSON.stringify({ userId }) })
}

export async function apiUnshareJob(jobId, userId) {
  return await request(`/api/jobs/${jobId}/share/${userId}`, { method: 'DELETE' })
}

export async function apiGetSharedJobs() {
  return await request('/api/jobs/shared')
}

export async function apiGetJobSharedWith(jobId) {
  return await request(`/api/jobs/${jobId}/shared-with`)
}

export async function apiApplyToJobFull(jobId, { name, email, message }, cvFile, letterFile) {
  const form = new FormData()
  form.append('name', name)
  form.append('email', email)
  if (message) form.append('message', message)
  if (cvFile) form.append('cv', cvFile)
  if (letterFile) form.append('application_letter', letterFile)
  try {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: formHeaders(),
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

// ── CV Profile ────────────────────────────────────────────────────────────────
export async function apiGetCVProfile() {
  return await request('/api/cv/profile')
}

export async function apiGetPublicCVProfile(userId) {
  return await request(`/api/cv/profile/${userId}`)
}

export async function apiSetCVVisibility(cvPublic) {
  return await request('/api/cv/visibility', { method: 'PATCH', body: JSON.stringify({ cv_public: cvPublic }) })
}

export async function apiAddWorkExperience(data) {
  return await request('/api/cv/experience', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateWorkExperience(id, data) {
  return await request(`/api/cv/experience/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function apiDeleteWorkExperience(id) {
  return await request(`/api/cv/experience/${id}`, { method: 'DELETE' })
}

export async function apiAddEducation(data) {
  return await request('/api/cv/education', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateEducation(id, data) {
  return await request(`/api/cv/education/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function apiDeleteEducation(id) {
  return await request(`/api/cv/education/${id}`, { method: 'DELETE' })
}

export async function apiAddLanguage(data) {
  return await request('/api/cv/languages', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateLanguage(id, proficiency) {
  return await request(`/api/cv/languages/${id}`, { method: 'PUT', body: JSON.stringify({ proficiency }) })
}

export async function apiDeleteLanguage(id) {
  return await request(`/api/cv/languages/${id}`, { method: 'DELETE' })
}

export async function apiGenerateCV(jobId, type) {
  return await request('/api/cv/generate', { method: 'POST', body: JSON.stringify({ job_id: jobId || null, type: type || 'both' }) })
}

// ── CRM Contact Notes ─────────────────────────────────────────────────────────
export async function apiGetContactNote(userId) {
  return await request(`/api/contact-notes/${userId}`)
}

export async function apiSaveContactNote(userId, note) {
  return await request(`/api/contact-notes/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  })
}

export async function apiGetAllContactNotes() {
  return await request('/api/contact-notes')
}

// ── Scheduled Posts ───────────────────────────────────────────────────────────
export async function apiGetScheduledPosts() {
  return await request('/api/feed/scheduled')
}

export async function apiReschedulePost(postId, scheduledAt) {
  return await request(`/api/feed/scheduled/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify({ scheduled_at: scheduledAt || null }),
  })
}

// ── Company Lead Capture ──────────────────────────────────────────────────────
export async function apiSubmitCompanyLead(companyId, data) {
  return await request(`/api/companies/${companyId}/leads`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiGetCompanyLeads(companyId) {
  return await request(`/api/companies/${companyId}/leads`)
}

export async function apiUpdateCompanyLead(companyId, leadId, status) {
  return await request(`/api/companies/${companyId}/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

// ── Easter Eggs ──────────────────────────────────────────────────────────────
export async function apiPostEasterEggEvent(eggId, event) {
  return await request("/api/easter-eggs/event", { method: "POST", body: JSON.stringify({ eggId, event }) })
}
export async function apiGetMyEasterEggs() {
  return await request('/api/easter-eggs')
}
export async function apiGetAdminEasterEggStats() {
  return await request("/api/admin/easter-eggs/stats")
}
export async function apiGetAdminEasterEggConfig() {
  return await request('/api/admin/easter-eggs/config')
}
export async function apiSaveAdminEasterEggConfig(cfg) {
  return await request('/api/admin/easter-eggs/config', { method: 'PUT', body: JSON.stringify(cfg) })
}
export async function apiGetEasterEggHints() {
  return await request('/api/easter-eggs/hints')
}

// ── Badge reward system ───────────────────────────────────────────────────────
// Evaluate and award new badges for the current user. Returns { newBadges: [] }.
export async function apiEvaluateBadges() {
  return await request('/api/badges/evaluate', { method: 'POST' })
}
// Get all earned badges for the current user.
export async function apiGetEarnedBadges() {
  return await request('/api/badges/earned')
}
// Get earned badges for any user (for hover tooltips).
export async function apiGetUserBadges(userId) {
  return await request(`/api/users/${userId}/badges`)
}
// Get all badge definitions with enabled state (auth required).
export async function apiGetAllBadges() {
  return await request('/api/badges/all')
}
// Admin: aggregate badge award stats.
export async function apiGetAdminBadgeStats() {
  return await request('/api/admin/badges/stats')
}
// Admin: enable or disable a badge by ID.
export async function apiToggleBadge(badgeId, enabled) {
  return await request(`/api/admin/badges/${badgeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

// ── Ad-Free Days: Badge-Based Rewards ──────────────────────────────────────────
export async function apiGetAdfreeBank() {
  return await request('/api/adfree/bank')
}
export async function apiGetAdfreeAssignments(startDate, endDate) {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate)
  if (endDate) params.append('endDate', endDate)
  return await request(`/api/adfree/assignments?${params}`)
}
export async function apiCheckAdfreeDate(date) {
  return await request(`/api/adfree/is-active?date=${date}`)
}
export async function apiAssignAdfreedays(startDate, endDate) {
  return await request('/api/adfree/assign', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate }),
  })
}

// ── Stories ───────────────────────────────────────────────────────────────────
export async function apiGetStoriesFeed() {
  return await request('/api/stories/feed')
}
export async function apiCreateStory(content_text, bg_color) {
  return await request('/api/stories', { method: 'POST', body: JSON.stringify({ content_text, bg_color }) })
}
export async function apiDeleteStory(id) {
  return await request(`/api/stories/${id}`, { method: 'DELETE' })
}

export async function apiGetSuggestedPosts(excludeIds = []) {
  const params = new URLSearchParams({ limit: '20' })
  if (excludeIds.length) params.set('exclude_ids', excludeIds.join(','))
  return await request(`/api/feed/suggested-posts?${params}`)
}

// ── Explore ───────────────────────────────────────────────────────────────────
export async function apiGetTrendingTags() {
  return await request('/api/explore/trending-tags')
}
export async function apiGetExploreFeed(cursor, filter, tag) {
  const params = new URLSearchParams({ filter: filter || 'all' })
  if (cursor) params.set('cursor', cursor)
  if (tag) params.set('tag', tag)
  return await request(`/api/explore/feed?${params}`)
}
export async function apiGetSuggestedUsers(limit = 6) {
  return await request(`/api/users/suggested?limit=${limit}`)
}

// ── Signal Engine / Interest Graph ────────────────────────────────────────────
// Batch-send behavioral signals to the server. Each signal: { signal_type, source_type?, source_id?, interest_slugs?, context? }
export async function apiIngestSignals(signals) {
  return await request('/api/signals', { method: 'POST', body: JSON.stringify({ signals }) })
}
// Get the authenticated user's computed interest graph
export async function apiGetInterestGraph() {
  return await request('/api/me/interest-graph')
}
// Manually correct a single interest weight (0–100)
export async function apiCorrectInterest(slug, weight, context = 'hobby') {
  return await request(`/api/me/interest-graph/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify({ weight, context }) })
}
// Get signal stats for transparency UI (last 30 days)
export async function apiGetSignalStats() {
  return await request('/api/me/interest-graph/signal-stats')
}

// Get user ID by handle (no auth required for public profile discovery)
export async function apiGetUserByHandle(handle) {
  return await request(`/api/user/handle/${encodeURIComponent(handle)}`)
}

// Platform ads (admin-managed)
export async function apiAdminGetPlatformAds() {
  return await request('/api/admin/platform-ads')
}
export async function apiAdminCreatePlatformAd(payload) {
  return await request('/api/admin/platform-ads', { method: 'POST', body: JSON.stringify(payload) })
}
export async function apiAdminUpdatePlatformAd(id, payload) {
  return await request(`/api/admin/platform-ads/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}
export async function apiAdminDeletePlatformAd(id) {
  return await request(`/api/admin/platform-ads/${id}`, { method: 'DELETE' })
}

// Unlock locked account (admin only)
export async function apiAdminGetLockedUsers() {
  return await request('/api/admin/locked-users')
}
export async function apiAdminUnlockUser(userId) {
  return await request(`/api/admin/users/${userId}/unlock`, { method: 'POST' })
}
export async function apiAdminGrowth(days = 30) {
  return await request(`/api/admin/growth?days=${days}`)
}
export async function apiAdminOnlineNow() {
  return await request('/api/admin/online-now')
}
export async function apiAdminGetBannedUsers() {
  return await request('/api/admin/banned-users')
}
export async function apiAdminSearchUsers(q = '') {
  return await request(q ? `/api/admin/users?q=${encodeURIComponent(q)}` : '/api/admin/users')
}
export async function apiAdminForceLogout(userId) {
  return await request(`/api/admin/users/${userId}/force-logout`, { method: 'POST' })
}
export async function apiAdminDeleteUser(userId) {
  return await request(`/api/admin/users/${userId}`, { method: 'DELETE' })
}
export async function apiAdminGetAuditLog({ limit = 50, offset = 0, action, userId } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (action) params.set('action', action)
  if (userId) params.set('userId', userId)
  return await request(`/api/admin/audit-log?${params}`)
}

// Business profile fields (business mode only)
export async function apiUpdateBusinessProfile(data) {
  return await request('/api/me/business-profile', { method: 'PATCH', body: JSON.stringify(data) })
}

// ── Business Discovery ────────────────────────────────────────────────────────
export async function apiGetBusinesses(params = {}) {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.q) qs.set('q', params.q)
  if (params.limit) qs.set('limit', params.limit)
  if (params.offset) qs.set('offset', params.offset)
  const query = qs.toString()
  return await request(`/api/businesses${query ? '?' + query : ''}`)
}
export async function apiGetSuggestedBusinesses() {
  return await request('/api/businesses/suggested')
}
export async function apiFollowBusiness(id) {
  return await request(`/api/businesses/${id}/follow`, { method: 'POST' })
}
export async function apiUnfollowBusiness(id) {
  return await request(`/api/businesses/${id}/follow`, { method: 'DELETE' })
}
export async function apiGetBusinessProfile(handle) {
  return await request(`/api/businesses/${encodeURIComponent(handle)}`)
}

// ── mediamtx / RTMP streaming ─────────────────────────────────────────────────

export async function apiGetActiveStreams() {
  return await request('/api/stream/active')
}

// ── Share / Repost ────────────────────────────────────────────────────────────
export async function apiSharePost(postId, comment) {
  return await request(`/api/posts/${postId}/share`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  })
}
export async function apiUnsharePost(postId) {
  return await request(`/api/posts/${postId}/share`, { method: 'DELETE' })
}

// ── Saved posts / Bookmarks ───────────────────────────────────────────────────
export async function apiSavePost(postId) {
  return await request(`/api/posts/${postId}/save`, { method: 'POST' })
}
export async function apiUnsavePost(postId) {
  return await request(`/api/posts/${postId}/save`, { method: 'DELETE' })
}
export async function apiGetSavedPosts() {
  return await request('/api/saved-posts')
}

// ── Polls ─────────────────────────────────────────────────────────────────────
export async function apiCreatePoll(postId, options, endsInHours) {
  return await request(`/api/posts/${postId}/poll`, {
    method: 'POST',
    body: JSON.stringify({ options, ends_in_hours: endsInHours }),
  })
}
export async function apiGetPoll(postId) {
  return await request(`/api/posts/${postId}/poll`)
}
export async function apiVotePoll(pollId, optionId) {
  return await request(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  })
}

// ── Nested comment replies ────────────────────────────────────────────────────
export async function apiReplyToComment(commentId, text) {
  return await request(`/api/comments/${commentId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
export async function apiGetCommentReplies(commentId) {
  return await request(`/api/comments/${commentId}/replies`)
}

// ── Message reactions ─────────────────────────────────────────────────────────
export async function apiReactToMessage(messageId, emoji) {
  return await request(`/api/messages/${messageId}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}
export async function apiRemoveMessageReaction(messageId) {
  return await request(`/api/messages/${messageId}/react`, { method: 'DELETE' })
}

// ── Profile cover photo ───────────────────────────────────────────────────────
export async function apiUploadCoverPhoto(file) {
  const form = new FormData()
  form.append('cover', file)
  try {
    const res = await fetch(`${API_BASE}/api/profile/cover`, {
      method: 'POST',
      headers: formHeaders(),
      credentials: 'same-origin',
      body: form,
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}
export async function apiDeleteCoverPhoto() {
  return await request('/api/profile/cover', { method: 'DELETE' })
}

// ── Pinned post ───────────────────────────────────────────────────────────────
export async function apiSetPinnedPost(postId) {
  return await request('/api/profile/pinned-post', {
    method: 'PATCH',
    body: JSON.stringify({ post_id: postId }),
  })
}

// ── Hashtag follows ───────────────────────────────────────────────────────────
export async function apiGetHashtagFollows() {
  return await request('/api/me/hashtag-follows')
}
export async function apiFollowHashtag(tag) {
  return await request(`/api/hashtags/${encodeURIComponent(tag)}/follow`, { method: 'POST' })
}
export async function apiUnfollowHashtag(tag) {
  return await request(`/api/hashtags/${encodeURIComponent(tag)}/follow`, { method: 'DELETE' })
}

// ── Story highlights ──────────────────────────────────────────────────────────
export async function apiGetMyStoryHighlights() {
  return await request('/api/me/story-highlights')
}
export async function apiGetUserStoryHighlights(userId) {
  return await request(`/api/users/${userId}/story-highlights`)
}
export async function apiCreateStoryHighlight(title, coverEmoji) {
  return await request('/api/story-highlights', {
    method: 'POST',
    body: JSON.stringify({ title, cover_emoji: coverEmoji }),
  })
}
export async function apiAddStoryToHighlight(highlightId, storyId) {
  return await request(`/api/story-highlights/${highlightId}/stories/${storyId}`, { method: 'POST' })
}
export async function apiDeleteStoryHighlight(highlightId) {
  return await request(`/api/story-highlights/${highlightId}`, { method: 'DELETE' })
}

// ── Story reactions ───────────────────────────────────────────────────────────
export async function apiReactToStory(storyId, emoji) {
  return await request(`/api/stories/${storyId}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}
export async function apiGetStoryReactions(storyId) {
  return await request(`/api/stories/${storyId}/reactions`)
}

// ── Event ICS export ──────────────────────────────────────────────────────────
export function apiGetEventIcsUrl(eventId) {
  return `${API_BASE}/api/events/${eventId}/ics`
}

// ── Marketplace wishlist ──────────────────────────────────────────────────────
export async function apiSaveListing(listingId) {
  return await request(`/api/marketplace/${listingId}/save`, { method: 'POST' })
}
export async function apiUnsaveListing(listingId) {
  return await request(`/api/marketplace/${listingId}/save`, { method: 'DELETE' })
}
export async function apiGetSavedListings() {
  return await request('/api/marketplace/saved')
}

// ── Marketplace price offers ──────────────────────────────────────────────────
export async function apiMakeOffer(listingId, amount, message) {
  return await request(`/api/marketplace/${listingId}/offers`, {
    method: 'POST',
    body: JSON.stringify({ amount, message }),
  })
}
export async function apiGetOffers(listingId) {
  return await request(`/api/marketplace/${listingId}/offers`)
}
export async function apiRespondToOffer(offerId, status) {
  return await request(`/api/marketplace/offers/${offerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

// ── Job alerts ────────────────────────────────────────────────────────────────
export async function apiGetJobAlerts() {
  return await request('/api/me/job-alerts')
}
export async function apiCreateJobAlert(query, location, jobType, frequency) {
  return await request('/api/me/job-alerts', {
    method: 'POST',
    body: JSON.stringify({ query, location, job_type: jobType, frequency }),
  })
}
export async function apiDeleteJobAlert(id) {
  return await request(`/api/me/job-alerts/${id}`, { method: 'DELETE' })
}

// ── Company reviews ───────────────────────────────────────────────────────────
export async function apiGetCompanyReviews(companyId) {
  return await request(`/api/companies/${companyId}/reviews`)
}
export async function apiCreateCompanyReview(companyId, rating, title, body) {
  return await request(`/api/companies/${companyId}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ rating, title, body }),
  })
}
export async function apiDeleteCompanyReview(companyId) {
  return await request(`/api/companies/${companyId}/reviews`, { method: 'DELETE' })
}

// ── Company business hours ────────────────────────────────────────────────────
export async function apiGetCompanyHours(companyId) {
  return await request(`/api/companies/${companyId}/hours`)
}
export async function apiSaveCompanyHours(companyId, hours) {
  return await request(`/api/companies/${companyId}/hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours }),
  })
}

// ── Company Q&A ───────────────────────────────────────────────────────────────
export async function apiGetCompanyQA(companyId) {
  return await request(`/api/companies/${companyId}/qa`)
}
export async function apiAskCompanyQuestion(companyId, question) {
  return await request(`/api/companies/${companyId}/qa`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}
export async function apiAnswerCompanyQuestion(companyId, qaId, answer) {
  return await request(`/api/companies/${companyId}/qa/${qaId}/answer`, {
    method: 'PATCH',
    body: JSON.stringify({ answer }),
  })
}
export async function apiDeleteCompanyQuestion(companyId, qaId) {
  return await request(`/api/companies/${companyId}/qa/${qaId}`, { method: 'DELETE' })
}

// ── Profile portfolio ─────────────────────────────────────────────────────────
export async function apiGetMyPortfolio() {
  return await request('/api/me/portfolio')
}
export async function apiGetUserPortfolio(userId) {
  return await request(`/api/users/${userId}/portfolio`)
}
export async function apiCreatePortfolioItem(title, description, url, imageUrl) {
  return await request('/api/me/portfolio', {
    method: 'POST',
    body: JSON.stringify({ title, description, url, image_url: imageUrl }),
  })
}
export async function apiUpdatePortfolioItem(id, title, description, url, imageUrl) {
  return await request(`/api/me/portfolio/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, description, url, image_url: imageUrl }),
  })
}
export async function apiDeletePortfolioItem(id) {
  return await request(`/api/me/portfolio/${id}`, { method: 'DELETE' })
}

// ── Post → reel conversion ────────────────────────────────────────────────────
export async function apiConvertPostToReel(postId) {
  return await request(`/api/feed/${postId}/convert-to-reel`, { method: 'POST' })
}

// ── Reel → feed share ─────────────────────────────────────────────────────────
export async function apiShareReelToFeed(reelId) {
  return await request(`/api/reels/${reelId}/share-to-feed`, { method: 'POST' })
}

// ── Blog ──────────────────────────────────────────────────────────────────────
export const apiFetchBlogPosts = () => request('/api/blog')
export const apiFetchBlogPost = (slug) => request(`/api/blog/${slug}`)
export const apiFetchAdminBlogPosts = () => request('/api/admin/blog')
export const apiCreateBlogPost = (data) => request('/api/admin/blog', { method: 'POST', body: JSON.stringify(data) })
export const apiUpdateBlogPost = (id, data) => request(`/api/admin/blog/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const apiDeleteBlogPost = (id) => request(`/api/admin/blog/${id}`, { method: 'DELETE' })
export const apiBlogTranslate = (text, from, to) => request('/api/admin/blog/translate', { method: 'POST', body: JSON.stringify({ text, from, to }) })

// ── Facebook data import ───────────────────────────────────────────────────────
// GET /api/auth/facebook/data — fetch fresh profile data from Graph API
export const apiFacebookGetData = () => request('/api/auth/facebook/data')

// POST /api/auth/facebook/import — apply selected fields to the user's profile
export const apiFacebookImport = (fields) =>
  request('/api/auth/facebook/import', { method: 'POST', body: JSON.stringify({ fields }) })

// POST /api/auth/facebook/disconnect — revoke FB token and clear fb_connected
export const apiFacebookDisconnect = () =>
  request('/api/auth/facebook/disconnect', { method: 'POST' })

// POST /api/auth/facebook/import-photos — download selected FB photos into feed
export const apiFacebookImportPhotos = (photoIds) =>
  request('/api/auth/facebook/import-photos', { method: 'POST', body: JSON.stringify({ photoIds }) })

// ── Business Features V2 ──────────────────────────────────────────────────────

// Feature 1: User Leads / Contact inbox
export const apiContactBusiness = (id, topic, message) =>
  request(`/api/businesses/${id}/contact`, { method: 'POST', body: JSON.stringify({ topic, message }) })
export const apiGetMyBusinessLeads = () => request('/api/me/business-leads')
export const apiUpdateBusinessLead = (id, status) =>
  request(`/api/me/business-leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })

// Feature 2: Jobs linked to business profile
export const apiGetBusinessJobs = (id) => request(`/api/businesses/${id}/jobs`)

// Feature 3: Business CVR verification
export const apiLookupCVR = (cvr) => request(`/api/me/verify-business/lookup?cvr=${encodeURIComponent(cvr)}`)
export const apiSubmitBusinessVerification = (cvr_number) =>
  request('/api/me/verify-business', { method: 'POST', body: JSON.stringify({ cvr_number }) })
export const apiAdminGetVerifications = () => request('/api/admin/verify-business')
export const apiAdminApproveVerification = (userId, approved) =>
  request(`/api/admin/verify-business/${userId}`, { method: 'POST', body: JSON.stringify({ approved }) })

// Feature 4: Follower broadcast announcements
export const apiCreateAnnouncement = (title, body, cta_url) =>
  request('/api/me/announcements', { method: 'POST', body: JSON.stringify({ title, body, cta_url }) })
export const apiGetMyAnnouncements = () => request('/api/me/announcements')
export const apiGetFollowedAnnouncements = () => request('/api/announcements')
export const apiDeleteAnnouncement = (id) =>
  request(`/api/me/announcements/${id}`, { method: 'DELETE' })

// Feature 5: Product / Services catalog
export const apiGetBusinessServices = (id) => request(`/api/businesses/${id}/services`)
export const apiGetMyServices = () => request('/api/me/services')
export const apiCreateService = (data) =>
  request('/api/me/services', { method: 'POST', body: JSON.stringify(data) })
export const apiUpdateService = (id, data) =>
  request(`/api/me/services/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const apiDeleteService = (id) =>
  request(`/api/me/services/${id}`, { method: 'DELETE' })

// Feature 6: Business event promotion
export const apiGetBusinessEvents = (id) => request(`/api/businesses/${id}/events`)

// Feature 7: Analytics depth
export const apiGetFollowerGrowth = (days = 30) =>
  request(`/api/me/analytics/follower-growth?days=${days}`)
export const apiGetBestPostTimes = () => request('/api/me/analytics/best-times')

// Feature 8: Service endorsements
export const apiGetBusinessEndorsements = (id) => request(`/api/businesses/${id}/endorsements`)

// Feature 9: B2B partner connections
export const apiSendPartnerRequest = (id) =>
  request(`/api/businesses/${id}/partner-request`, { method: 'POST' })
export const apiGetPartnerRequests = () => request('/api/me/partner-requests')
export const apiRespondPartnerRequest = (id, action) =>
  request(`/api/me/partner-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
export const apiGetMyPartners = () => request('/api/me/partners')
export const apiRemovePartner = (partnerId) =>
  request(`/api/me/partners/${partnerId}`, { method: 'DELETE' })
export const apiGetBusinessPartners = (id) => request(`/api/businesses/${id}/partners`)

// Feature 10: Appointment / inquiry via DM
export const apiSendBusinessInquiry = (id, subject, preferred_date, message) =>
  request(`/api/businesses/${id}/inquiry`, { method: 'POST', body: JSON.stringify({ subject, preferred_date, message }) })

// User type selector
export const apiUpdateUserType = (mode) =>
  request('/api/user/type', { method: 'PATCH', body: JSON.stringify({ mode }) })

export const apiGetUserFeatures = () => request('/api/user/features')
export const apiGetUserType = (userId) => request(`/api/user/${userId}/type`)
export const apiGetCompanyProfile = (userId) => request(`/api/company/profile/${userId}`)
