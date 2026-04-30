import { useState, useEffect } from 'react'
import GroupCard from './GroupCard.jsx'
import GroupCreate from './GroupCreate.jsx'
import {
  apiGetGroups, apiGetMyGroups,
  apiGetPendingGroups, apiApproveGroup, apiRejectGroup,
} from './api.js'
import { getTranslations, nameToColor } from './data.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

const CATEGORIES = ['interest', 'local', 'professional', 'event', 'other']
const SORTS = ['trending', 'newest', 'members']

const ROLE_STYLE = {
  admin:     { bg: '#FEE2E2', color: '#991B1B' },
  moderator: { bg: '#FEF3C7', color: '#92400E' },
  member:    { bg: '#F3F4F6', color: '#6B7280' },
}

export default function GroupsPage({ lang, currentUser, onNavigate }) {
  const t = getTranslations(lang)
  const g = t?.groups || {}

  const isAdmin = Boolean(currentUser?.is_admin)

  const [tab, setTab] = useState('discover')
  const [showCreate, setShowCreate] = useState(false)

  const [groups, setGroups] = useState([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('trending')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [myGroups, setMyGroups] = useState([])
  const [myGroupsLoading, setMyGroupsLoading] = useState(false)
  const [myGroupsLoaded, setMyGroupsLoaded] = useState(false)

  const [pending, setPending] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingLoaded, setPendingLoaded] = useState(false)

  useEffect(() => {
    if (tab !== 'discover') return
    setDiscoverLoading(true)
    apiGetGroups({ category, search, sort }).then(data => {
      setDiscoverLoading(false)
      if (data?.groups) setGroups(data.groups)
    })
  }, [tab, category, search, sort])

  useEffect(() => {
    if (tab !== 'myGroups' || myGroupsLoaded) return
    setMyGroupsLoading(true)
    apiGetMyGroups().then(data => {
      setMyGroupsLoading(false)
      setMyGroupsLoaded(true)
      if (data?.groups) setMyGroups(data.groups)
    })
  }, [tab, myGroupsLoaded])

  useEffect(() => {
    if (tab !== 'pending' || pendingLoaded) return
    setPendingLoading(true)
    apiGetPendingGroups().then(data => {
      setPendingLoading(false)
      setPendingLoaded(true)
      if (data?.groups) setPending(data.groups)
    })
  }, [tab, pendingLoaded])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const handleApprove = async (id) => {
    const res = await apiApproveGroup(id)
    if (res !== null) setPending(prev => prev.filter(p => p.id !== id))
  }

  const handleReject = async (id) => {
    const res = await apiRejectGroup(id)
    if (res !== null) setPending(prev => prev.filter(p => p.id !== id))
  }

  const TABS = ['discover', 'myGroups', ...(isAdmin ? ['pending'] : [])]
  const TAB_LABEL = { discover: g.discover, myGroups: g.myGroups, pending: g.pending }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>{g.pageTitle}</h1>
        <button style={s.createBtn} onClick={() => setShowCreate(true)}>
          {'+ '}{g.createTitle}
        </button>
      </div>

      <div style={s.tabBar}>
        {TABS.map(key => (
          <button
            key={key}
            style={{ ...s.tabBtn, ...(tab === key ? s.tabActive : {}) }}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key] || key}
          </button>
        ))}
      </div>

      <div style={s.content}>
        {tab === 'discover' && (
          <div>
            <div style={s.filters}>
              <form style={s.searchForm} onSubmit={handleSearch}>
                <input
                  style={s.searchInput}
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={g.searchPlaceholder || ''}
                />
                <button type="submit" style={s.searchBtn}>{'🔍'}</button>
              </form>
              <select style={s.select} value={category} onChange={e => { setCategory(e.target.value) }}>
                <option value="">{g.allCategories}</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{g.category?.[c] || c}</option>
                ))}
              </select>
              <select style={s.select} value={sort} onChange={e => setSort(e.target.value)}>
                {SORTS.map(sv => (
                  <option key={sv} value={sv}>{g.sort?.[sv] || sv}</option>
                ))}
              </select>
            </div>
            {discoverLoading ? (
              <div style={s.empty}>{g.loading}</div>
            ) : groups.length === 0 ? (
              <div style={s.empty}>{g.noGroups}</div>
            ) : (
              <div style={s.grid}>
                {groups.map(group => (
                  <GroupCard key={group.id} group={group} lang={lang} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'myGroups' && (
          <div>
            {myGroupsLoading ? (
              <div style={s.empty}>{g.loading}</div>
            ) : myGroups.length === 0 ? (
              <div style={s.empty}>
                <div>{g.noMyGroups}</div>
                <button
                  style={s.discoverCta}
                  onClick={() => setTab('discover')}
                >
                  {g.discoverCta || 'Opdag grupper →'}
                </button>
              </div>
            ) : myGroups.map(group => {
              const roleMeta = ROLE_STYLE[group.my_role] || ROLE_STYLE.member
              const roleLabel = g.role?.[group.my_role] || group.my_role
              const coverSrc = group.cover_url
                ? (group.cover_url.startsWith('http') ? group.cover_url : `${API_BASE}${group.cover_url}`)
                : null
              return (
                <div
                  key={group.id}
                  style={s.myGroupRow}
                  onClick={() => onNavigate?.(`/groups/${group.slug}`)}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F9F7F5' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
                >
                  {coverSrc
                    ? <img src={coverSrc} alt="" style={s.myGroupThumb} />
                    : <div style={{ ...s.myGroupThumb, background: nameToColor(group.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 700 }}>
                        {group.name?.[0]?.toUpperCase() || '?'}
                      </div>
                  }
                  <div style={s.myGroupInfo}>
                    <div style={s.myGroupName}>{group.name}</div>
                    <div style={s.myGroupMeta}>
                      {group.category && <span style={s.catPill}>{g.category?.[group.category] || group.category}</span>}
                      <span style={s.metaText}>{'👥 '}{Number(group.member_count) || 0}{' '}{Number(group.member_count) === 1 ? g.member : g.members}</span>
                    </div>
                  </div>
                  <span style={{ ...s.roleBadge, background: roleMeta.bg, color: roleMeta.color }}>
                    {roleLabel}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'pending' && isAdmin && (
          <div>
            {pendingLoading ? (
              <div style={s.empty}>{g.loading}</div>
            ) : pending.length === 0 ? (
              <div style={s.empty}>{g.noPending}</div>
            ) : pending.map(group => (
              <div key={group.id} style={s.pendingRow}>
                <div style={s.pendingInfo}>
                  <div style={s.pendingName}>{group.name}</div>
                  <div style={s.pendingMeta}>
                    {group.category && <span style={s.catPill}>{g.category?.[group.category] || group.category}</span>}
                    <span style={s.metaText}>{'👥 '}{Number(group.member_count) || 0}</span>
                    {group.creator_name && (
                      <span style={s.metaText}>{g.by} {group.creator_name}</span>
                    )}
                  </div>
                  {(group.description_da || group.description_en) && (
                    <p style={s.pendingDesc}>
                      {lang === 'da' ? group.description_da : (group.description_en || group.description_da)}
                    </p>
                  )}
                </div>
                <div style={s.pendingActions}>
                  <button style={s.approveBtn} onClick={() => handleApprove(group.id)}>
                    {g.approve}
                  </button>
                  <button style={s.rejectBtn} onClick={() => handleReject(group.id)}>
                    {g.reject}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <GroupCreate
          lang={lang}
          onClose={() => setShowCreate(false)}
          onCreated={(group) => {
            setShowCreate(false)
            onNavigate?.(`/groups/${group.slug}`)
          }}
        />
      )}
    </div>
  )
}

const s = {
  page: { maxWidth: 900, margin: '0 auto', paddingBottom: 48 },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 20px 0', marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: 0 },
  createBtn: {
    fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 20,
    border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff',
    cursor: 'pointer',
  },
  tabBar: {
    display: 'flex', gap: 0, padding: '0 20px',
    background: '#fff', borderBottom: '1px solid #E8E4DF', overflowX: 'auto',
  },
  tabBtn: {
    fontSize: 13, fontWeight: 600, padding: '10px 16px',
    border: 'none', borderBottom: '2px solid transparent',
    background: 'none', color: '#888', cursor: 'pointer',
    whiteSpace: 'nowrap', transition: 'color 0.15s',
  },
  tabActive: { color: '#4338CA', borderBottom: '2px solid #4338CA' },
  content: { padding: '16px 20px' },
  empty: { textAlign: 'center', color: '#bbb', fontSize: 14, padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  discoverCta: {
    fontSize: 13, fontWeight: 700, padding: '8px 20px', borderRadius: 20,
    border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff',
    cursor: 'pointer',
  },
  filters: {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center',
  },
  searchForm: { display: 'flex', gap: 0, flex: '1 1 200px', minWidth: 160 },
  searchInput: {
    flex: 1, fontSize: 13, padding: '8px 12px',
    border: '1px solid #E8E4DF', borderRight: 'none',
    borderRadius: '20px 0 0 20px', outline: 'none', background: '#F9F7F5',
  },
  searchBtn: {
    fontSize: 13, padding: '8px 12px',
    border: '1px solid #E8E4DF', borderLeft: 'none',
    borderRadius: '0 20px 20px 0',
    background: '#F0EDE8', cursor: 'pointer',
  },
  select: {
    fontSize: 13, padding: '7px 10px', borderRadius: 20,
    border: '1px solid #E8E4DF', background: '#F9F7F5', color: '#444',
    cursor: 'pointer', outline: 'none',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 16,
  },
  // My Groups
  myGroupRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 8px', borderBottom: '1px solid #F0EDE8',
    cursor: 'pointer', background: '#fff', borderRadius: 8,
    transition: 'background 0.12s',
  },
  myGroupThumb: {
    width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0,
  },
  myGroupInfo: { flex: 1, minWidth: 0 },
  myGroupName: {
    fontSize: 14, fontWeight: 700, color: '#1a1a1a',
    marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  myGroupMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  catPill: {
    fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
    background: '#F0EDE8', color: '#666',
  },
  metaText: { fontSize: 12, color: '#888' },
  roleBadge: {
    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, flexShrink: 0,
  },
  // Pending
  pendingRow: {
    display: 'flex', alignItems: 'flex-start', gap: 16,
    padding: '14px 0', borderBottom: '1px solid #F0EDE8',
    flexWrap: 'wrap',
  },
  pendingInfo: { flex: 1, minWidth: 200 },
  pendingName: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  pendingMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  pendingDesc: {
    fontSize: 13, color: '#666', lineHeight: 1.5, margin: '4px 0 0',
    display: '-webkit-box', WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  pendingActions: { display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' },
  approveBtn: {
    fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 20,
    border: '1.5px solid #16A34A', background: '#16A34A', color: '#fff',
    cursor: 'pointer',
  },
  rejectBtn: {
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 20,
    border: '1.5px solid #DC2626', background: '#fff', color: '#DC2626',
    cursor: 'pointer',
  },
}
