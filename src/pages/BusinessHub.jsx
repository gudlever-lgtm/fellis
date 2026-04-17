import { useState, useEffect, useRef } from 'react'
import {
  apiGetMyBusinessLeads, apiUpdateBusinessLead,
  apiCreateAnnouncement, apiGetMyAnnouncements, apiDeleteAnnouncement,
  apiGetMyServices, apiCreateService, apiUpdateService, apiDeleteService,
  apiGetPartnerRequests, apiGetMyPartners, apiRespondPartnerRequest, apiRemovePartner,
  apiLookupCVR, apiSubmitBusinessVerification,
  apiGetFollowerGrowth, apiGetBestPostTimes,
} from '../api.js'
import { formatPrice } from '../utils/currency.js'
import BusinessDirectory from './BusinessDirectory.jsx'
import AdManager from './AdManager.jsx'

// ── Colour helpers ────────────────────────────────────────────────────────────
const LEAD_STATUS_STYLE = {
  new:       { background: '#DBEAFE', color: '#1E40AF' },
  responded: { background: '#D1FAE5', color: '#065F46' },
  archived:  { background: '#F3F4F6', color: '#6B7280' },
}

const DOW_LABELS_DA = ['', 'søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']
const DOW_LABELS_EN = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Tiny bar chart ────────────────────────────────────────────────────────────
function MiniBar({ values, color = '#6366F1', height = 40 }) {
  const max = Math.max(...values, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, background: color, opacity: 0.15 + (v / max) * 0.85,
          height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%`,
          borderRadius: 2,
        }} />
      ))}
    </div>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────────
function SectionCard({ title, children, action }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #F3F4F6' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111827' }}>{title}</h3>
        {action}
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  )
}

// ── Leads inbox ───────────────────────────────────────────────────────────────
function LeadsSection({ t, lang }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('new')

  useEffect(() => {
    setLoading(true)
    apiGetMyBusinessLeads().then(d => { setLeads(d?.leads || []); setLoading(false) })
  }, [])

  const update = async (id, status) => {
    await apiUpdateBusinessLead(id, status)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  }

  const visible = leads.filter(l => filter === 'all' || l.status === filter)
  const counts = { new: leads.filter(l => l.status === 'new').length }

  return (
    <SectionCard title={t.leadsInbox} action={
      <div style={{ display: 'flex', gap: 6 }}>
        {['new','responded','archived','all'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
            background: filter === s ? '#6366F1' : '#F3F4F6',
            color: filter === s ? '#fff' : '#374151', fontWeight: filter === s ? 600 : 400,
          }}>
            {s === 'new' ? `${t.leadStatusNew}${counts.new ? ` (${counts.new})` : ''}` :
             s === 'responded' ? t.leadStatusResponded :
             s === 'archived' ? t.leadStatusArchived : (lang === 'da' ? 'Alle' : 'All')}
          </button>
        ))}
      </div>
    }>
      {loading ? <p style={{ color: '#9CA3AF', margin: 0 }}>{lang === 'da' ? 'Indlæser…' : 'Loading…'}</p> :
       visible.length === 0 ? <p style={{ color: '#9CA3AF', margin: 0 }}>{t.noLeads}</p> :
       visible.map(lead => (
         <div key={lead.id} style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: 14, marginBottom: 14 }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
             {lead.sender_avatar
               ? <img src={lead.sender_avatar} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
               : <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>{(lead.sender_name || lead.name)[0]}</div>
             }
             <div style={{ flex: 1 }}>
               <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{lead.sender_name || lead.name}</span>
               {lead.sender_handle && <span style={{ color: '#9CA3AF', fontSize: 12, marginLeft: 6 }}>@{lead.sender_handle}</span>}
               <div style={{ fontSize: 11, color: '#9CA3AF' }}>{new Date(lead.created_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
             </div>
             <span style={{ ...LEAD_STATUS_STYLE[lead.status], fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
               {t[`leadStatus${lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}`]}
             </span>
           </div>
           {lead.topic && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 4 }}><strong>{t.leadTopic}:</strong> {lead.topic}</div>}
           <div style={{ fontSize: 13, color: '#374151', marginBottom: 10, whiteSpace: 'pre-wrap' }}>{lead.message}</div>
           <div style={{ display: 'flex', gap: 8 }}>
             {lead.status !== 'responded' && <button onClick={() => update(lead.id, 'responded')} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #D1FAE5', background: '#F0FDF4', color: '#065F46', cursor: 'pointer' }}>{t.markResponded}</button>}
             {lead.status !== 'archived' && <button onClick={() => update(lead.id, 'archived')} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', color: '#6B7280', cursor: 'pointer' }}>{t.markArchived}</button>}
           </div>
         </div>
       ))}
    </SectionCard>
  )
}

// ── Announcements ─────────────────────────────────────────────────────────────
function AnnouncementsSection({ t }) {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', body: '', cta_url: '' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setLoading(true)
    apiGetMyAnnouncements().then(d => { setAnnouncements(d?.announcements || []); setLoading(false) })
  }, [])

  const publish = async () => {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    const r = await apiCreateAnnouncement(form.title, form.body, form.cta_url || undefined)
    setSaving(false)
    if (r?.ok) {
      setSuccess(t.announcementPublished)
      setForm({ title: '', body: '', cta_url: '' })
      setShowForm(false)
      setTimeout(() => setSuccess(''), 3000)
      apiGetMyAnnouncements().then(d => setAnnouncements(d?.announcements || []))
    }
  }

  const remove = async (id) => {
    await apiDeleteAnnouncement(id)
    setAnnouncements(prev => prev.filter(a => a.id !== id))
  }

  return (
    <SectionCard title={t.announcements} action={
      <button onClick={() => setShowForm(s => !s)} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: 'none', background: '#6366F1', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
        {t.newAnnouncement}
      </button>
    }>
      {success && <div style={{ background: '#D1FAE5', color: '#065F46', padding: '8px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{success}</div>}
      {showForm && (
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 14, marginBottom: 16, border: '1px solid #E5E7EB' }}>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder={t.announcementTitle} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }} />
          <textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} placeholder={t.announcementBody} rows={4} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, marginBottom: 10, resize: 'vertical', boxSizing: 'border-box' }} />
          <input value={form.cta_url} onChange={e => setForm(p => ({ ...p, cta_url: e.target.value }))} placeholder={t.announcementCta} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }} />
          <button onClick={publish} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#6366F1', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            {saving ? '…' : t.publishAnnouncement}
          </button>
        </div>
      )}
      {loading ? <p style={{ color: '#9CA3AF', margin: 0 }}>…</p> :
       announcements.length === 0 ? <p style={{ color: '#9CA3AF', margin: 0 }}>{t.noAnnouncements}</p> :
       announcements.map(a => (
         <div key={a.id} style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: 12, marginBottom: 12 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
             <div>
               <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 }}>{a.title}</div>
               <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', marginBottom: 4 }}>{a.body}</div>
               {a.cta_url && <a href={a.cta_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#6366F1' }}>{a.cta_url}</a>}
               <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{new Date(a.created_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
             </div>
             <button onClick={() => remove(a.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #FEE2E2', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 10 }}>{t.deleteAnnouncement}</button>
           </div>
         </div>
       ))}
    </SectionCard>
  )
}

// ── Services catalog ──────────────────────────────────────────────────────────
function ServicesSection({ t, lang }) {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name_da: '', name_en: '', description_da: '', description_en: '', price_from: '', price_to: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiGetMyServices().then(d => { setServices(d?.services || []); setLoading(false) })
  }, [])

  const resetForm = () => { setForm({ name_da: '', name_en: '', description_da: '', description_en: '', price_from: '', price_to: '' }); setEditId(null); setShowForm(false) }

  const save = async () => {
    if (!form.name_da.trim() || !form.name_en.trim()) return
    setSaving(true)
    const data = {
      name_da: form.name_da.trim(), name_en: form.name_en.trim(),
      description_da: form.description_da.trim() || undefined,
      description_en: form.description_en.trim() || undefined,
      price_from: form.price_from ? parseFloat(form.price_from) : undefined,
      price_to: form.price_to ? parseFloat(form.price_to) : undefined,
    }
    if (editId) {
      await apiUpdateService(editId, data)
    } else {
      await apiCreateService(data)
    }
    setSaving(false)
    resetForm()
    apiGetMyServices().then(d => setServices(d?.services || []))
  }

  const del = async (id) => {
    await apiDeleteService(id)
    setServices(prev => prev.filter(s => s.id !== id))
  }

  const startEdit = (svc) => {
    setForm({ name_da: svc.name_da, name_en: svc.name_en, description_da: svc.description_da || '', description_en: svc.description_en || '', price_from: svc.price_from || '', price_to: svc.price_to || '' })
    setEditId(svc.id)
    setShowForm(true)
  }

  const nameKey = lang === 'da' ? 'name_da' : 'name_en'
  const descKey = lang === 'da' ? 'description_da' : 'description_en'

  return (
    <SectionCard title={t.servicesLabel} action={
      <button onClick={() => { resetForm(); setShowForm(s => !s) }} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: 'none', background: '#6366F1', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
        {t.addService}
      </button>
    }>
      {showForm && (
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 14, marginBottom: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input value={form.name_da} onChange={e => setForm(p => ({ ...p, name_da: e.target.value }))} placeholder={t.serviceNameDa} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
            <input value={form.name_en} onChange={e => setForm(p => ({ ...p, name_en: e.target.value }))} placeholder={t.serviceNameEn} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
            <textarea value={form.description_da} onChange={e => setForm(p => ({ ...p, description_da: e.target.value }))} placeholder={t.serviceDescriptionDa} rows={2} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical' }} />
            <textarea value={form.description_en} onChange={e => setForm(p => ({ ...p, description_en: e.target.value }))} placeholder={t.serviceDescriptionEn} rows={2} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical' }} />
            <input type="number" value={form.price_from} onChange={e => setForm(p => ({ ...p, price_from: e.target.value }))} placeholder={t.servicePriceFrom} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
            <input type="number" value={form.price_to} onChange={e => setForm(p => ({ ...p, price_to: e.target.value }))} placeholder={t.servicePriceTo} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#6366F1', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              {saving ? '…' : t.saveService}
            </button>
            <button onClick={resetForm} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 14 }}>{lang === 'da' ? 'Annuller' : 'Cancel'}</button>
          </div>
        </div>
      )}
      {loading ? <p style={{ color: '#9CA3AF', margin: 0 }}>…</p> :
       services.length === 0 ? <p style={{ color: '#9CA3AF', margin: 0 }}>{t.noServices}</p> :
       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
         {services.map(svc => (
           <div key={svc.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 14 }}>
             {svc.image_url && <img src={svc.image_url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />}
             <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 }}>{svc[nameKey]}</div>
             {svc[descKey] && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>{svc[descKey]}</div>}
             {(svc.price_from || svc.price_to) && (
               <div style={{ fontSize: 13, color: '#6366F1', fontWeight: 600, marginBottom: 8 }}>
                 {svc.price_from && svc.price_to ? `${formatPrice(svc.price_from)} – ${formatPrice(svc.price_to)}` :
                  svc.price_from ? `${lang === 'da' ? 'Fra' : 'From'} ${formatPrice(svc.price_from)}` :
                  formatPrice(svc.price_to)}
               </div>
             )}
             <div style={{ display: 'flex', gap: 6 }}>
               <button onClick={() => startEdit(svc)} style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#374151', cursor: 'pointer', fontSize: 12 }}>{lang === 'da' ? 'Rediger' : 'Edit'}</button>
               <button onClick={() => del(svc.id)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FEE2E2', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontSize: 12 }}>{t.deleteService}</button>
             </div>
           </div>
         ))}
       </div>}
    </SectionCard>
  )
}

// ── B2B Partners ──────────────────────────────────────────────────────────────
function PartnersSection({ t, lang, onViewProfile }) {
  const [partners, setPartners] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('partners')

  const load = () => {
    setLoading(true)
    Promise.all([apiGetMyPartners(), apiGetPartnerRequests()]).then(([p, r]) => {
      setPartners(p?.partners || [])
      setRequests(r?.requests || [])
      setLoading(false)
    })
  }
  useEffect(load, [])

  const respond = async (id, action) => {
    await apiRespondPartnerRequest(id, action)
    load()
  }

  const remove = async (partnerId) => {
    await apiRemovePartner(partnerId)
    setPartners(prev => prev.filter(p => p.id !== partnerId))
  }

  return (
    <SectionCard title={t.b2bPartners} action={
      requests.length > 0 && (
        <button onClick={() => setTab('requests')} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, border: 'none', background: '#FEF3C7', color: '#92400E', cursor: 'pointer', fontWeight: 600 }}>
          {requests.length} {lang === 'da' ? 'ventende' : 'pending'}
        </button>
      )
    }>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['partners', 'requests'].map(s => (
          <button key={s} onClick={() => setTab(s)} style={{
            padding: '4px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
            background: tab === s ? '#6366F1' : '#F3F4F6',
            color: tab === s ? '#fff' : '#374151', fontWeight: tab === s ? 600 : 400,
          }}>
            {s === 'partners' ? t.b2bPartners : `${t.partnerRequests}${requests.length ? ` (${requests.length})` : ''}`}
          </button>
        ))}
      </div>
      {loading ? <p style={{ color: '#9CA3AF', margin: 0 }}>…</p> :
       tab === 'requests' ? (
         requests.length === 0 ? <p style={{ color: '#9CA3AF', margin: 0 }}>{t.noPartnerRequests}</p> :
         requests.map(r => (
           <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #F3F4F6', paddingBottom: 12, marginBottom: 12 }}>
             {r.requester_avatar
               ? <img src={r.requester_avatar} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} />
               : <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>{r.requester_name[0]}</div>
             }
             <div style={{ flex: 1 }}>
               <div style={{ fontWeight: 600, fontSize: 14 }}>{r.requester_name} {r.requester_verified ? <span style={{ color: '#6366F1', fontSize: 12 }}>✓</span> : null}</div>
               {r.requester_category && <div style={{ fontSize: 12, color: '#6B7280' }}>{r.requester_category}</div>}
             </div>
             <button onClick={() => respond(r.id, 'accept')} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#6366F1', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t.acceptPartner}</button>
             <button onClick={() => respond(r.id, 'decline')} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 12 }}>{t.declinePartner}</button>
           </div>
         ))
       ) : (
         partners.length === 0 ? <p style={{ color: '#9CA3AF', margin: 0 }}>{t.noPartners}</p> :
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
           {partners.map(p => (
             <div key={p.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                 {p.avatar_url
                   ? <img src={p.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                   : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>{p.name[0]}</div>
                 }
                 <div>
                   <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name} {p.is_verified ? <span style={{ color: '#6366F1', fontSize: 11 }}>✓</span> : null}</div>
                   {p.business_category && <div style={{ fontSize: 11, color: '#6B7280' }}>{p.business_category}</div>}
                 </div>
               </div>
               <div style={{ display: 'flex', gap: 6 }}>
                 <button onClick={() => onViewProfile(p.id)} style={{ flex: 1, padding: '4px 0', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#374151', cursor: 'pointer', fontSize: 12 }}>{lang === 'da' ? 'Se profil' : 'View profile'}</button>
                 <button onClick={() => remove(p.id)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #FEE2E2', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontSize: 12 }}>{t.removePartner}</button>
               </div>
             </div>
           ))}
         </div>
       )}
    </SectionCard>
  )
}

// ── Follower growth + best times ──────────────────────────────────────────────
function AnalyticsDepthSection({ t, lang }) {
  const [growth, setGrowth] = useState(null)
  const [heatmap, setHeatmap] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([apiGetFollowerGrowth(days), apiGetBestPostTimes()]).then(([g, h]) => {
      setGrowth(g)
      setHeatmap(h?.heatmap || [])
      setLoading(false)
    })
  }, [days])

  const DOW_LABELS = lang === 'da' ? DOW_LABELS_DA : DOW_LABELS_EN

  // Build a dense day-by-day follower growth array
  const growthValues = (() => {
    if (!growth?.growth) return Array(days).fill(0)
    const map = {}
    growth.growth.forEach(r => { map[r.date.slice(0, 10)] = Number(r.count) })
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i))
      return map[d.toISOString().slice(0, 10)] || 0
    })
  })()

  // Build engagement heatmap: dow (1-7) × hour (0-23) → total engagements
  const maxEngagement = heatmap?.length ? Math.max(...heatmap.map(r => r.engagements), 1) : 1

  return (
    <SectionCard title={lang === 'da' ? 'Avanceret analyse' : 'Advanced analytics'}>
      {loading ? <p style={{ color: '#9CA3AF', margin: 0 }}>…</p> : (
        <>
          {/* Follower growth */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{t.followerGrowth}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{t.followerGrowthDesc}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[7, 30, 90].map(d => (
                  <button key={d} onClick={() => setDays(d)} style={{ padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, background: days === d ? '#6366F1' : '#F3F4F6', color: days === d ? '#fff' : '#374151', fontWeight: days === d ? 600 : 400 }}>{d}d</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60, marginBottom: 4 }}>
              {growthValues.map((v, i) => (
                <div key={i} title={`${v}`} style={{
                  flex: 1, background: '#6366F1',
                  opacity: v === 0 ? 0.08 : 0.2 + (v / Math.max(...growthValues, 1)) * 0.8,
                  height: `${Math.max(v === 0 ? 4 : (v / Math.max(...growthValues, 1)) * 100, v > 0 ? 10 : 4)}%`,
                  borderRadius: '2px 2px 0 0',
                }} />
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', textAlign: 'right' }}>
              {lang === 'da' ? 'Samlet:' : 'Total:'} <strong style={{ color: '#111827' }}>{growth?.total ?? 0}</strong>
            </div>
          </div>

          {/* Best post times heatmap */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 2 }}>{t.bestPostTimes}</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>{t.bestPostTimesDesc}</div>
            {!heatmap?.length ? <p style={{ color: '#9CA3AF', fontSize: 13, margin: 0 }}>{t.noEngagementData}</p> : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(24, 1fr)', gap: 2, minWidth: 500 }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} style={{ fontSize: 9, color: '#9CA3AF', textAlign: 'center' }}>{h}</div>
                  ))}
                  {[1,2,3,4,5,6,7].map(dow => (
                    <>
                      <div key={`label-${dow}`} style={{ fontSize: 10, color: '#6B7280', display: 'flex', alignItems: 'center', paddingRight: 4 }}>{DOW_LABELS[dow]}</div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = heatmap.find(r => r.dow === dow && r.hour === h)
                        const v = cell?.engagements || 0
                        const intensity = v / maxEngagement
                        return (
                          <div key={`${dow}-${h}`} title={`${v}`} style={{
                            height: 16, borderRadius: 3,
                            background: v === 0 ? '#F3F4F6' : `rgba(99,102,241,${0.12 + intensity * 0.88})`,
                          }} />
                        )
                      })}
                    </>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </SectionCard>
  )
}

// ── CVR Verification ──────────────────────────────────────────────────────────
function VerificationSection({ t, lang, currentUser }) {
  const [cvr, setCvr] = useState('')
  const [lookup, setLookup] = useState(null)
  // lookupState: idle | loading | found | ready | error
  const [lookupState, setLookupState] = useState('idle')
  const [lookupError, setLookupError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [verified, setVerified] = useState(currentUser?.is_verified || false)
  const [verifiedData, setVerifiedData] = useState(
    currentUser?.is_verified
      ? { cvr: currentUser.cvr_number, name: currentUser.cvr_company_name }
      : null
  )
  const lookupTimer = useRef(null)

  const cleanCvr = (v) => v.replace(/[\s\-]/g, '')

  // CVR is ready to submit once it's 8 digits (checksum validated server-side)
  const isReady = /^\d{8}$/.test(cleanCvr(cvr))

  const handleChange = (e) => {
    const val = e.target.value.replace(/[^\d\s\-]/g, '')
    setCvr(val)
    setSubmitError('')
    setLookup(null)
    setLookupError('')

    clearTimeout(lookupTimer.current)
    const cleaned = cleanCvr(val)

    if (cleaned.length < 8) { setLookupState('idle'); return }
    if (!/^\d{8}$/.test(cleaned)) { setLookupState('error'); setLookupError(t.cvrFormatError); return }

    // Fetch company name preview — does NOT gate submission
    setLookupState('loading')
    lookupTimer.current = setTimeout(async () => {
      const res = await apiLookupCVR(cleaned)
      if (res && !res.error) {
        setLookup(res)
        setLookupState('found')
      } else {
        setLookupState('ready') // API unavailable — still allow submit
      }
    }, 600)
  }

  const submit = async () => {
    if (!isReady || submitting) return
    setSubmitting(true)
    setSubmitError('')
    const r = await apiSubmitBusinessVerification(cleanCvr(cvr))
    setSubmitting(false)
    if (r?.ok) {
      setVerified(true)
      setVerifiedData({ cvr: cleanCvr(cvr), name: r.companyName })
    } else {
      const errMap = { cvr_format: t.cvrFormatError, cvr_taken: t.cvrTakenError }
      setSubmitError(errMap[r?.error] || t.cvrVerifyError)
    }
  }

  if (verified) {
    return (
      <SectionCard title={t.verifyBusiness}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#065F46', fontSize: 14 }}>{t.verificationApproved}</div>
            {verifiedData?.name && <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>{verifiedData.name}</div>}
            {verifiedData?.cvr && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 1 }}>CVR {verifiedData.cvr}</div>}
          </div>
        </div>
      </SectionCard>
    )
  }

  const borderColor = lookupState === 'found' ? '#059669'
    : lookupState === 'error' ? '#EF4444'
    : '#D1D5DB'

  return (
    <SectionCard title={t.verifyBusiness}>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 14px', lineHeight: 1.5 }}>{t.cvrHelp}</p>
      <div style={{ position: 'relative' }}>
        <input
          value={cvr}
          onChange={handleChange}
          placeholder={t.cvrNumber}
          maxLength={10}
          style={{ width: '100%', padding: '10px 40px 10px 12px', borderRadius: 8, border: `1.5px solid ${borderColor}`, fontSize: 15, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s', letterSpacing: '0.05em' }}
        />
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, pointerEvents: 'none' }}>
          {lookupState === 'loading' && '⏳'}
          {lookupState === 'found' && '✓'}
          {lookupState === 'error' && '✗'}
        </span>
      </div>

      {lookupState === 'found' && lookup && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#059669', fontWeight: 700, marginBottom: 3 }}>{t.cvrFound}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{lookup.name}</div>
          {(lookup.city || lookup.industry) && (
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{[lookup.city, lookup.industry].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      )}

      {lookupState === 'error' && lookupError && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444' }}>{lookupError}</div>
      )}
      {submitError && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444' }}>{submitError}</div>
      )}

      <button
        onClick={submit}
        disabled={!isReady || submitting}
        style={{ marginTop: 14, width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: isReady && !submitting ? '#6366F1' : '#E5E7EB', color: isReady && !submitting ? '#fff' : '#9CA3AF', fontWeight: 600, fontSize: 14, cursor: isReady && !submitting ? 'pointer' : 'default', transition: 'background 0.15s' }}
      >
        {submitting ? '…' : t.submitVerification}
      </button>
    </SectionCard>
  )
}

// ── Main BusinessHub component ────────────────────────────────────────────────
const CONTENT_TAB_DEFS = [
  { id: 'leads',         icon: '📥', label: { da: 'Leads',        en: 'Leads' } },
  { id: 'announcements', icon: '📢', label: { da: 'Meddelelser',  en: 'Announcements' } },
  { id: 'services',      icon: '🛠️', label: { da: 'Ydelser',      en: 'Services' } },
  { id: 'partners',      icon: '🤝', label: { da: 'Partnere',     en: 'Partners' } },
  { id: 'analytics',     icon: '📊', label: { da: 'Analyse',      en: 'Analytics' } },
  { id: 'ads',           icon: '📣', label: { da: 'Annoncer',     en: 'Ads' } },
  { id: 'verify',        icon: '✅', label: { da: 'Verificér',    en: 'Verify' } },
  { id: 'directory',     icon: '🏢', label: { da: 'Virksomheder', en: 'Directory' } },
]

// Nav tabs navigate out to standalone pages rather than loading inline content
const NAV_TABS = [
  { id: 'jobs',    label: { da: 'Job',           en: 'Jobs' },       icon: '💼' },
  { id: 'company', label: { da: 'Min virksomhed', en: 'My Company' }, icon: '🏬' },
]

export default function BusinessHub({ lang, t, currentUser, onViewProfile, onNavigate }) {
  const [tab, setTab] = useState('leads')

  const isVerified = currentUser?.is_verified
  const cvrNumber  = currentUser?.cvr_number
  const cvrName    = currentUser?.cvr_company_name

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>{t.businessHub}</h2>
          {isVerified && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 700,
              background: '#D1FAE5', color: '#065F46',
              border: '1px solid #6EE7B7', borderRadius: 20,
              padding: '3px 10px',
            }}>
              ✓ {lang === 'da' ? 'CVR verificeret' : 'CVR verified'}
            </span>
          )}
        </div>
        {isVerified && (cvrName || cvrNumber) && (
          <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
            {cvrName}{cvrName && cvrNumber ? ' · ' : ''}{cvrNumber ? `CVR ${cvrNumber}` : ''}
          </p>
        )}
        {!isVerified && (
          <p style={{ fontSize: 14, color: '#6B7280', margin: '4px 0 0' }}>{t.businessHubDesc}</p>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {CONTENT_TAB_DEFS.map(({ id, icon, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            background: tab === id ? '#6366F1' : '#F3F4F6',
            color: tab === id ? '#fff' : '#374151',
            fontWeight: tab === id ? 600 : 400,
          }}>
            <span style={{ fontSize: 14 }}>{icon}</span>{label[lang] ?? label.en}
          </button>
        ))}
        {NAV_TABS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => onNavigate?.(id)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 20, border: 'none',
            cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            background: '#F3F4F6', color: '#374151', fontWeight: 400,
          }}>
            <span style={{ fontSize: 14 }}>{icon}</span>{label[lang] ?? label.en}
          </button>
        ))}
      </div>

      {tab === 'leads'         && <LeadsSection t={t} lang={lang} />}
      {tab === 'announcements' && <AnnouncementsSection t={t} lang={lang} />}
      {tab === 'services'      && <ServicesSection t={t} lang={lang} />}
      {tab === 'partners'      && <PartnersSection t={t} lang={lang} onViewProfile={onViewProfile} />}
      {tab === 'analytics'     && <AnalyticsDepthSection t={t} lang={lang} />}
      {tab === 'ads'           && <AdManager lang={lang} t={t} currentUser={currentUser} />}
      {tab === 'verify'        && <VerificationSection t={t} lang={lang} currentUser={currentUser} />}
      {tab === 'directory'     && <BusinessDirectory lang={lang} t={t} onViewProfile={onViewProfile} />}
    </div>
  )
}
