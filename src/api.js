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

// For FormData/multipart requests: only include X-Session-Id if we actually have one.
// Passing null/undefined would send the literal string "null" as the header value,
// which causes the server to reject the request as "Session expired".
function formHeaders() {
  const sid = getSessionId()
  return sid ? { 'X-Session-Id': sid } : {}
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

export async function apiVerifyMfa(userId, code, lang) {
  const data = await request('/api/auth/verify-mfa', {
    method: 'POST',
    body: JSON.stringify({ userId, code, lang }),
  })
  if (data?.sessionId) {
    localStorage.setItem('fellis_session_id', data.sessionId)
  }
  return data
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

export async function apiRevealPassword(mfaCode) {
  return await request('/api/auth/reveal-password', { method: 'POST', body: JSON.stringify({ mfaCode }) })
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
  // Try session check even without localStorage — cookie may carry the session
  return await request('/api/auth/session')
}

export async function apiLogout() {
  await request('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem('fellis_session_id')
}

// Feed
export async function apiFetchFeed(cursor = null, limit = 20) {
  const params = cursor
    ? `cursor=${encodeURIComponent(cursor)}&limit=${limit}`
    : `limit=${limit}`
  return await request(`/api/feed?${params}`)
}

export async function apiPreflightPost(text) {
  return await request('/api/feed/preflight', { method: 'POST', body: JSON.stringify({ text }) })
}

export async function apiFetchMemories() {
  return await request('/api/feed/memories')
}

export async function apiCreatePost(text, mediaFiles, scheduledAt, categories) {
  if (mediaFiles?.length) {
    // Use FormData for multipart upload
    const form = new FormData()
    form.append('text', text)
    if (scheduledAt) form.append('scheduled_at', scheduledAt)
    if (categories?.length) form.append('categories', JSON.stringify(categories))
    for (const file of mediaFiles) {
      form.append('media', file)
    }
    try {
      const res = await fetch(`${API_BASE}/api/feed`, {
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
  return await request('/api/feed', {
    method: 'POST',
    body: JSON.stringify({ text, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}), ...(categories?.length ? { categories } : {}) }),
  })
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

// Conversations (replaces legacy /api/messages)
export async function apiFetchConversations() {
  return await request('/api/conversations')
}

export async function apiMarkConversationRead(conversationId) {
  return await request(`/api/conversations/${conversationId}/read`, { method: 'POST' })
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

export async function apiCancelInvite(id) {
  return await request(`/api/invites/${id}`, { method: 'DELETE' })
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

export async function apiRelistListing(id) {
  return await request(`/api/marketplace/${id}/relist`, { method: 'POST' })
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

export async function apiRevealAdminKey(keyName, password) {
  return await request('/api/admin/settings/reveal-key', {
    method: 'POST',
    body: JSON.stringify({ key_name: keyName, password }),
  })
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

export async function apiUploadReel(videoFile, caption) {
  const form = new FormData()
  form.append('video', videoFile)
  if (caption) form.append('caption', caption)
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

// ── Calendar ──

export async function apiFetchCalendarEvents() {
  return await request('/api/calendar/events')
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
  return await request(`/api/feed/suggest-category?text=${encodeURIComponent(text)}`)
}

export async function apiGetMyJobs() {
  return await request('/api/jobs/mine')
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
  return await request('/api/ads')
}
export async function apiGetAd(id) {
  return await request(`/api/ads/${id}`)
}
export async function apiUpdateAd(id, data) {
  return await request(`/api/ads/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiDeleteAd(id) {
  return await request(`/api/ads/${id}`, { method: 'DELETE' })
}
export async function apiRecordAdImpression(id) {
  return await request(`/api/ads/${id}/impression`, { method: 'POST' })
}
export async function apiRecordAdClick(id) {
  return await request(`/api/ads/${id}/click`, { method: 'POST' })
}
export async function apiServeAds(placement) {
  return await request(`/api/ads?serve=1&placement=${placement}`)
}

// ── Ads-free subscription (Stripe) ───────────────────────────────────────────
export async function apiGetSubscription() {
  return await request('/api/me/subscription')
}
export async function apiCreateAdFreeCheckout() {
  return await request('/api/stripe/checkout/adfree', { method: 'POST' })
}

// ── Mollie payments ───────────────────────────────────────────────────────────
export async function apiCreateMolliePayment(plan, amount, currency, adId, recurring = false) {
  const body = { plan, recurring: !!recurring }
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

// ── Badge reward system ───────────────────────────────────────────────────────
// Evaluate and award new badges for the current user. Returns { newBadges: [] }.
export async function apiEvaluateBadges() {
  return await request('/api/badges/evaluate', { method: 'POST' })
}
// Get all earned badges for the current user.
export async function apiGetEarnedBadges() {
  return await request('/api/badges/earned')
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
  return await request('/api/signals', 'POST', { signals })
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
