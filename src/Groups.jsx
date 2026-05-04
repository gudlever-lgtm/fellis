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
  const isNewDesign = localStorage.getItem('fellis_design') === 'new'

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
    <div style={isNewDesign ? { ...s.page, margin: 0 } : s.page}>
      <div style={s.header}>
        <h1 style={s.title}>{g.pageTitle}</h1>
        <button style={s.createBtn} onClick={() => setShowCreate(true)}>
          {'+ '}{g.createTitle}
        </button>
      </div>

      <div className="grp-tab-bar">
        {TABS.map(key => (
          <button
            key={key}
            className={`grp-tab-btn${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key] || key}
          </button>
        ))}
      </div>

      <div className="grp-content">
        {tab === 'discover' && (
          <div>
            <div className="grp-filters">
              <form className="grp-search-form" onSubmit={handleSearch}>
                <input
                  className="grp-search-input"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={g.searchPlaceholder || ''}
                />
                <button type="submit" className="grp-search-btn">{'🔍'}</button>
              </form>
              <select className="grp-select" value={category} onChange={e => { setCategory(e.target.value) }}>
                <option value="">{g.allCategories}</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{g.category?.[c] || c}</option>
                ))}
              </select>
              <select className="grp-select" value={sort} onChange={e => setSort(e.target.value)}>
                {SORTS.map(sv => (
                  <option key={sv} value={sv}>{g.sort?.[sv] || sv}</option>
                ))}
              </select>
            </div>
            {discoverLoading ? (
              <div className="grp-empty">{g.loading}</div>
            ) : groups.length === 0 ? (
              <div className="grp-empty">{g.noGroups}</div>
            ) : (
              <div className="grp-grid">
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
              <div className="grp-empty">{g.loading}</div>
            ) : myGroups.length === 0 ? (
              <div className="grp-empty">
                <div>{g.noMyGroups}</div>
                <button
                  style={sCreateBtn}
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
                  className="grp-my-row"
                  onClick={() => onNavigate?.(`/groups/${group.slug}`)}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F9F7F5' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
                >
                  {coverSrc
                    ? <img src={coverSrc} alt="" className="grp-my-thumb" />
                    : <div className="grp-my-thumb grp-my-thumb-fallback" style={{ background: nameToColor(group.name) }}>
                        {group.name?.[0]?.toUpperCase() || '?'}
                      </div>
                  }
                  <div className="grp-my-info">
                    <div className="grp-my-name">{group.name}</div>
                    <div className="grp-my-meta">
                      {group.category && <span className="grp-cat-pill">{g.category?.[group.category] || group.category}</span>}
                      <span className="grp-meta-text">{'👥 '}{Number(group.member_count) || 0}{' '}{Number(group.member_count) === 1 ? g.member : g.members}</span>
                    </div>
                  </div>
                  <span className="grp-role-badge" style={{ background: roleMeta.bg, color: roleMeta.color }}>
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
              <div className="grp-empty">{g.loading}</div>
            ) : pending.length === 0 ? (
              <div className="grp-empty">{g.noPending}</div>
            ) : pending.map(group => (
              <div key={group.id} className="grp-pending-row">
                <div className="grp-pending-info">
                  <div className="grp-pending-name">{group.name}</div>
                  <div className="grp-pending-meta">
                    {group.category && <span className="grp-cat-pill">{g.category?.[group.category] || group.category}</span>}
                    <span className="grp-meta-text">{'👥 '}{Number(group.member_count) || 0}</span>
                    {group.creator_name && (
                      <span className="grp-meta-text">{g.by} {group.creator_name}</span>
                    )}
                  </div>
                  {(group.description_da || group.description_en) && (
                    <p className="grp-pending-desc">
                      {lang === 'da' ? group.description_da : (group.description_en || group.description_da)}
                    </p>
                  )}
                </div>
                <div className="grp-pending-actions">
                  <button style={sApproveBtn} onClick={() => handleApprove(group.id)}>
                    {g.approve}
                  </button>
                  <button style={sRejectBtn} onClick={() => handleReject(group.id)}>
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
  page:      { maxWidth: 900, margin: '0 auto', padding: '24px 16px' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:     { fontSize: 24, fontWeight: 800, color: '#1a1a2e', margin: 0 },
  createBtn: { fontSize: 14, fontWeight: 700, padding: '9px 20px', borderRadius: 22,
               border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff', cursor: 'pointer' },
}

const sCreateBtn = {
  fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 20,
  border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff',
  cursor: 'pointer',
}

const sApproveBtn = {
  fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 20,
  border: '1.5px solid #16A34A', background: '#16A34A', color: '#fff',
  cursor: 'pointer',
}

const sRejectBtn = {
  fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 20,
  border: '1.5px solid #DC2626', background: '#fff', color: '#DC2626',
  cursor: 'pointer',
}
