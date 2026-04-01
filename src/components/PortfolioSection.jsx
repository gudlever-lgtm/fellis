import { useState, useEffect } from 'react'
import { apiGetMyPortfolio, apiGetUserPortfolio, apiCreatePortfolioItem, apiUpdatePortfolioItem, apiDeletePortfolioItem } from '../api.js'

function PortfolioCard({ item, isOwn, onEdit, onDelete, lang }) {
  return (
    <div className="p-card" style={{ padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 10 }}>
      {item.image_url && (
        <img src={item.image_url} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{item.title}</div>
        {item.description && <div style={{ fontSize: 13, color: '#555', marginTop: 4, lineHeight: 1.5 }}>{item.description}</div>}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#1877F2', marginTop: 6, display: 'inline-block', wordBreak: 'break-all' }}>
            🔗 {item.url.replace(/^https?:\/\//, '').split('/')[0]}
          </a>
        )}
      </div>
      {isOwn && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(item)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>✏️</button>
          <button onClick={() => onDelete(item.id)}
            style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#fee', color: '#c00', cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      )}
    </div>
  )
}

function PortfolioForm({ item, lang, onSave, onCancel }) {
  const [title, setTitle] = useState(item?.title || '')
  const [description, setDescription] = useState(item?.description || '')
  const [url, setUrl] = useState(item?.url || '')
  const [imageUrl, setImageUrl] = useState(item?.image_url || '')
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? { titlePh: 'Projekttitel *', descPh: 'Beskrivelse', urlPh: 'Link (valgfri)', imgPh: 'Billed-URL (valgfri)', save: 'Gem', cancel: 'Annuller' }
    : { titlePh: 'Project title *', descPh: 'Description', urlPh: 'Link (optional)', imgPh: 'Image URL (optional)', save: 'Save', cancel: 'Cancel' }

  const handleSave = async () => {
    if (!title.trim()) return
    setSaving(true)
    await onSave({ title, description, url, imageUrl })
    setSaving(false)
  }

  return (
    <div className="p-card" style={{ marginBottom: 14, padding: '16px 18px' }}>
      <input placeholder={t.titlePh} value={title} onChange={e => setTitle(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
      <textarea placeholder={t.descPh} value={description} onChange={e => setDescription(e.target.value)} rows={3}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, resize: 'vertical', marginBottom: 8, boxSizing: 'border-box' }} />
      <input placeholder={t.urlPh} value={url} onChange={e => setUrl(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
      <input placeholder={t.imgPh} value={imageUrl} onChange={e => setImageUrl(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving || !title.trim()}
          style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          {saving ? '…' : t.save}
        </button>
        <button onClick={onCancel}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
          {t.cancel}
        </button>
      </div>
    </div>
  )
}

export default function PortfolioSection({ userId, isOwn, lang }) {
  const [items, setItems] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const t = lang === 'da'
    ? { title: 'Portfolio', add: '+ Tilføj projekt', empty: 'Ingen projekter endnu.' }
    : { title: 'Portfolio', add: '+ Add project', empty: 'No projects yet.' }

  const load = () => {
    const fn = isOwn ? apiGetMyPortfolio : () => apiGetUserPortfolio(userId)
    fn().then(d => setItems(d?.items || []))
  }

  useEffect(() => { load() }, [userId, isOwn]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async ({ title, description, url, imageUrl }) => {
    await apiCreatePortfolioItem(title, description, url, imageUrl)
    setShowAdd(false)
    load()
  }

  const handleEdit = async ({ title, description, url, imageUrl }) => {
    await apiUpdatePortfolioItem(editItem.id, title, description, url, imageUrl)
    setEditItem(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm(lang === 'da' ? 'Slet dette projekt?' : 'Delete this project?')) return
    await apiDeletePortfolioItem(id)
    load()
  }

  if (!items) return null
  if (items.length === 0 && !isOwn) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🗂️ {t.title}</h3>
        {isOwn && (
          <button onClick={() => { setShowAdd(true); setEditItem(null) }}
            style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            {t.add}
          </button>
        )}
      </div>

      {showAdd && <PortfolioForm lang={lang} onSave={handleAdd} onCancel={() => setShowAdd(false)} />}

      {items.length === 0 && !showAdd && <div style={{ fontSize: 14, color: '#888' }}>{t.empty}</div>}

      {items.map(item => (
        editItem?.id === item.id
          ? <PortfolioForm key={item.id} item={item} lang={lang} onSave={handleEdit} onCancel={() => setEditItem(null)} />
          : <PortfolioCard key={item.id} item={item} isOwn={isOwn} onEdit={setEditItem} onDelete={handleDelete} lang={lang} />
      ))}
    </div>
  )
}
