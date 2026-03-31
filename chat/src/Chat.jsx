import { useState, useEffect, useRef, useCallback } from 'react'
import { apiGetConversations, apiGetMessages, apiSendMessage } from './api.js'
import { t } from './data.js'

const POLL_INTERVAL = 5000

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

export default function Chat({ lang, user, onLogout }) {
  const [conversations, setConversations] = useState([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [convError, setConvError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgError, setMsgError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const messagesEndRef = useRef(null)
  const pollRef = useRef(null)
  const isMobile = useIsMobile()

  const loadConversations = useCallback(async () => {
    const res = await apiGetConversations()
    if (!res || res.error) {
      setConvError(t(lang, 'errorLoadConversations'))
    } else {
      setConversations(Array.isArray(res) ? res : [])
      setConvError('')
    }
    setLoadingConvs(false)
  }, [lang])

  const loadMessages = useCallback(async (convId) => {
    setLoadingMsgs(true)
    setMsgError('')
    const res = await apiGetMessages(convId)
    if (!res || res.error) {
      setMsgError(t(lang, 'errorLoadMessages'))
    } else {
      setMessages(res.messages || [])
    }
    setLoadingMsgs(false)
  }, [lang])

  const pollMessages = useCallback(async (convId) => {
    const res = await apiGetMessages(convId)
    if (res && !res.error) {
      setMessages(res.messages || [])
    }
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!selectedId) return
    loadMessages(selectedId)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => pollMessages(selectedId), POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [selectedId, loadMessages, pollMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    if (!draft.trim() || !selectedId) return
    setSendError('')
    setSending(true)
    const res = await apiSendMessage(selectedId, draft.trim(), lang)
    setSending(false)
    if (!res || res.error) {
      setSendError(t(lang, 'sendError'))
    } else {
      setDraft('')
      await pollMessages(selectedId)
    }
  }

  const s = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      background: '#f4f5f7',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      height: 52,
      background: '#1877f2',
      color: '#fff',
      flexShrink: 0,
    },
    headerTitle: {
      fontWeight: 700,
      fontSize: 18,
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
    },
    logoutBtn: {
      background: 'rgba(255,255,255,0.18)',
      border: 'none',
      color: '#fff',
      borderRadius: 6,
      padding: '5px 12px',
      cursor: 'pointer',
      fontSize: 13,
    },
    body: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden',
      flexDirection: isMobile ? 'column' : 'row',
    },
    sidebar: {
      width: isMobile ? '100%' : 280,
      flexShrink: 0,
      background: '#fff',
      borderRight: isMobile ? 'none' : '1.5px solid #eee',
      borderBottom: isMobile ? '1.5px solid #eee' : 'none',
      display: isMobile && selectedId ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    sidebarHeader: {
      padding: '14px 16px 10px',
      fontWeight: 700,
      fontSize: 14,
      color: '#333',
      borderBottom: '1px solid #f0f0f0',
      flexShrink: 0,
    },
    convList: {
      flex: 1,
      overflowY: 'auto',
    },
    convItem: (active) => ({
      padding: '12px 16px',
      cursor: 'pointer',
      background: active ? '#e8f0fe' : 'transparent',
      borderBottom: '1px solid #f4f4f4',
      transition: 'background 0.12s',
    }),
    convName: {
      fontWeight: 600,
      fontSize: 14,
      color: '#222',
      marginBottom: 2,
    },
    convMeta: {
      fontSize: 12,
      color: '#888',
    },
    unreadBadge: {
      display: 'inline-block',
      background: '#1877f2',
      color: '#fff',
      borderRadius: 10,
      padding: '1px 7px',
      fontSize: 11,
      fontWeight: 700,
      marginLeft: 6,
    },
    mainPanel: {
      flex: 1,
      display: isMobile && !selectedId ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    threadHeader: {
      padding: '12px 16px',
      fontWeight: 700,
      fontSize: 15,
      borderBottom: '1.5px solid #eee',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
    },
    backBtn: {
      background: 'none',
      border: 'none',
      color: '#1877f2',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 600,
      padding: '2px 6px',
    },
    messageList: {
      flex: 1,
      overflowY: 'auto',
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    },
    bubble: (mine) => ({
      maxWidth: '70%',
      alignSelf: mine ? 'flex-end' : 'flex-start',
      background: mine ? '#1877f2' : '#fff',
      color: mine ? '#fff' : '#222',
      borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
      padding: '8px 14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      fontSize: 14,
    }),
    bubbleMeta: {
      fontSize: 11,
      opacity: 0.65,
      marginTop: 3,
      textAlign: 'right',
    },
    inputRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      background: '#fff',
      borderTop: '1.5px solid #eee',
      flexShrink: 0,
    },
    textInput: {
      flex: 1,
      padding: '9px 14px',
      border: '1.5px solid #ddd',
      borderRadius: 20,
      fontSize: 14,
      outline: 'none',
      background: '#f8f9fa',
    },
    sendBtn: {
      padding: '9px 18px',
      background: sending ? '#aac8f7' : '#1877f2',
      color: '#fff',
      border: 'none',
      borderRadius: 20,
      fontSize: 14,
      fontWeight: 700,
      cursor: sending ? 'default' : 'pointer',
    },
    placeholder: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#aaa',
      fontSize: 15,
    },
    infoText: {
      textAlign: 'center',
      color: '#aaa',
      fontSize: 13,
      padding: 20,
    },
    errorText: {
      textAlign: 'center',
      color: '#d32f2f',
      fontSize: 13,
      padding: 16,
    },
  }

  const selectedConv = conversations.find(c => c.id === selectedId)
  const myName = user?.name || ''

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.headerTitle}>{t(lang, 'appName')}</span>
        <div style={s.headerRight}>
          <span>{myName}</span>
          <button style={s.logoutBtn} onClick={onLogout}>{t(lang, 'logout')}</button>
        </div>
      </div>

      <div style={s.body}>
        {/* Conversation list sidebar */}
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>{t(lang, 'conversations')}</div>
          <div style={s.convList}>
            {loadingConvs && <div style={s.infoText}>{t(lang, 'loadingConversations')}</div>}
            {convError && <div style={s.errorText}>{convError}</div>}
            {!loadingConvs && !convError && conversations.length === 0 && (
              <div style={s.infoText}>{t(lang, 'noConversations')}</div>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                style={s.convItem(conv.id === selectedId)}
                onClick={() => setSelectedId(conv.id)}
              >
                <div style={s.convName}>
                  {conv.name || (conv.isGroup ? t(lang, 'group') : '?')}
                  {conv.unread > 0 && (
                    <span style={s.unreadBadge}>{conv.unread}</span>
                  )}
                </div>
                {conv.isGroup && (
                  <div style={s.convMeta}>{t(lang, 'group')}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Message thread panel */}
        <div style={s.mainPanel}>
          {!selectedId ? (
            <div style={s.placeholder}>{t(lang, 'selectConversation')}</div>
          ) : (
            <>
              <div style={s.threadHeader}>
                {isMobile && (
                  <button style={s.backBtn} onClick={() => setSelectedId(null)}>
                    ← {t(lang, 'backToList')}
                  </button>
                )}
                {selectedConv?.name || t(lang, 'messages')}
              </div>

              <div style={s.messageList}>
                {loadingMsgs && <div style={s.infoText}>{t(lang, 'loadingMessages')}</div>}
                {msgError && <div style={s.errorText}>{msgError}</div>}
                {!loadingMsgs && !msgError && messages.length === 0 && (
                  <div style={s.infoText}>{t(lang, 'noMessages')}</div>
                )}
                {messages.map((msg, i) => {
                  const mine = msg.from === myName
                  const text = msg.text?.[lang] || msg.text?.da || msg.text?.en || ''
                  return (
                    <div key={i} style={s.bubble(mine)}>
                      {!mine && (
                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, opacity: 0.75 }}>
                          {msg.from}
                        </div>
                      )}
                      {text}
                      <div style={s.bubbleMeta}>{msg.time}</div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              <form style={s.inputRow} onSubmit={handleSend}>
                <input
                  style={s.textInput}
                  type="text"
                  placeholder={t(lang, 'typeMessage')}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  disabled={sending}
                />
                <button style={s.sendBtn} type="submit" disabled={sending || !draft.trim()}>
                  {sending ? t(lang, 'sending') : t(lang, 'send')}
                </button>
              </form>
              {sendError && <div style={s.errorText}>{sendError}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
