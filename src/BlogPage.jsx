import { useState, useEffect } from 'react'
import { detectLang } from './data.js'
import { getTranslations } from './i18n/index.js'
import {
  apiFetchBlogPosts, apiFetchBlogPost,
  apiFetchAdminBlogPosts, apiCreateBlogPost, apiUpdateBlogPost, apiDeleteBlogPost,
} from './api.js'

const GREEN = '#2D6A4F'
const BORDER = '#E8E4DF'
const TEXT = '#2D3436'
const MUTED = '#666'

function formatDate(dateStr, lang) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ── Admin Editor ──────────────────────────────────────────────────────────────
function BlogEditor({ post, onSave, onCancel, lang }) {
  const t = getTranslations(lang)
  const b = t.blog.admin
  const isNew = !post?.id

  const [form, setForm] = useState({
    slug: post?.slug || '',
    title_da: post?.title_da || '',
    title_en: post?.title_en || '',
    summary_da: post?.summary_da || '',
    summary_en: post?.summary_en || '',
    body_da: post?.body_da || '',
    body_en: post?.body_en || '',
    cover_image: post?.cover_image || '',
    published: post?.published ? true : false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    if (key === 'title_da' && isNew && !form.slug) {
      setForm(f => ({ ...f, [key]: val, slug: slugify(val) }))
    }
  }

  async function handleSave() {
    setError('')
    if (!form.slug.trim()) { setError(b.errorSlug); return }
    if (!form.title_da.trim() && !form.title_en.trim()) { setError(b.errorTitle); return }
    setSaving(true)
    const data = { ...form }
    const res = isNew
      ? await apiCreateBlogPost(data)
      : await apiUpdateBlogPost(post.id, data)
    setSaving(false)
    if (!res?.ok) {
      setError(res?.error === 'Slug already exists' ? b.errorDuplicate : (res?.error || 'Error'))
      return
    }
    onSave()
  }

  const s = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
    modal: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 28 },
    title: { fontSize: 18, fontWeight: 700, marginBottom: 20, color: TEXT },
    label: { display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 4 },
    input: { width: '100%', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box', marginBottom: 12 },
    textarea: { width: '100%', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, minHeight: 100, resize: 'vertical' },
    hint: { fontSize: 12, color: MUTED, marginTop: -10, marginBottom: 12 },
    row: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 },
    check: { accentColor: GREEN, width: 16, height: 16 },
    checkLabel: { fontSize: 14, color: TEXT },
    error: { background: '#fee', border: '1px solid #fcc', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#c00', marginBottom: 12 },
    btns: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
    btnPrimary: { background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    btnSecondary: { background: 'none', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '9px 20px', fontSize: 14, cursor: 'pointer' },
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={s.modal}>
        <div style={s.title}>{isNew ? b.newPost : b.edit}</div>

        <label style={s.label}>{b.slug}</label>
        <input style={s.input} value={form.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))} placeholder="min-blog-slug" />
        <p style={s.hint}>{b.slugHint}</p>

        <label style={s.label}>{b.titleDa}</label>
        <input style={s.input} value={form.title_da} onChange={e => set('title_da', e.target.value)} />

        <label style={s.label}>{b.titleEn}</label>
        <input style={s.input} value={form.title_en} onChange={e => set('title_en', e.target.value)} />

        <label style={s.label}>{b.summaryDa}</label>
        <textarea style={s.textarea} value={form.summary_da} onChange={e => set('summary_da', e.target.value)} rows={3} />

        <label style={s.label}>{b.summaryEn}</label>
        <textarea style={s.textarea} value={form.summary_en} onChange={e => set('summary_en', e.target.value)} rows={3} />

        <label style={s.label}>{b.bodyDa}</label>
        <textarea style={{ ...s.textarea, minHeight: 160 }} value={form.body_da} onChange={e => set('body_da', e.target.value)} />

        <label style={s.label}>{b.bodyEn}</label>
        <textarea style={{ ...s.textarea, minHeight: 160 }} value={form.body_en} onChange={e => set('body_en', e.target.value)} />

        <label style={s.label}>{b.coverImage}</label>
        <input style={s.input} value={form.cover_image} onChange={e => set('cover_image', e.target.value)} placeholder="https://..." />

        <div style={s.row}>
          <input type="checkbox" style={s.check} id="blog-published" checked={form.published} onChange={e => set('published', e.target.checked)} />
          <label htmlFor="blog-published" style={s.checkLabel}>{b.publishedStatus}</label>
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.btns}>
          <button style={s.btnSecondary} onClick={onCancel}>{b.cancel}</button>
          <button style={s.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? '…' : b.save}</button>
        </div>
      </div>
    </div>
  )
}

// ── Post Card ─────────────────────────────────────────────────────────────────
function PostCard({ post, lang, t, isAdmin, onEdit, onDelete, onClick }) {
  const title = lang === 'da' ? (post.title_da || post.title_en) : (post.title_en || post.title_da)
  const summary = lang === 'da' ? (post.summary_da || post.summary_en) : (post.summary_en || post.summary_da)

  const s = {
    card: { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.15s' },
    cover: { width: '100%', height: 200, objectFit: 'cover', display: 'block' },
    coverPlaceholder: { width: '100%', height: 200, background: '#f0ede8', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    body: { padding: 20 },
    meta: { fontSize: 12, color: MUTED, marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
    statusBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: post.published ? '#d4edda' : '#fff3cd', color: post.published ? '#155724' : '#856404' },
    h2: { fontSize: 18, fontWeight: 700, color: TEXT, margin: '0 0 8px', lineHeight: 1.3 },
    summary: { fontSize: 14, color: MUTED, lineHeight: 1.6, margin: '0 0 14px' },
    readMore: { color: GREEN, fontSize: 13, fontWeight: 600, textDecoration: 'none' },
    adminBtns: { display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` },
    btnEdit: { fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'none', cursor: 'pointer', color: TEXT },
    btnDel: { fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #fcc', background: 'none', cursor: 'pointer', color: '#c00' },
  }

  return (
    <div style={s.card} onClick={onClick}>
      {post.cover_image
        ? <img src={post.cover_image} alt={title} style={s.cover} onError={e => { e.target.style.display = 'none' }} />
        : <div style={s.coverPlaceholder}><span style={{ fontSize: 40 }}>✍️</span></div>
      }
      <div style={s.body}>
        <div style={s.meta}>
          {post.author_name && <span>{t.blog.by} {post.author_name}</span>}
          {(post.published_at || post.created_at) && <span>{formatDate(post.published_at || post.created_at, lang)}</span>}
          {isAdmin && <span style={s.statusBadge}>{post.published ? t.blog.admin.publishedStatus : t.blog.admin.draftStatus}</span>}
        </div>
        <h2 style={s.h2}>{title}</h2>
        {summary && <p style={s.summary}>{summary}</p>}
        <span style={s.readMore}>{t.blog.readMore} →</span>
        {isAdmin && (
          <div style={s.adminBtns} onClick={e => e.stopPropagation()}>
            <button style={s.btnEdit} onClick={onEdit}>{t.blog.admin.edit}</button>
            <button style={s.btnDel} onClick={onDelete}>{t.blog.admin.delete}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Article View ──────────────────────────────────────────────────────────────
function ArticleView({ slug, lang, t, isAdmin, onBack, onEdit }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetchBlogPost(slug).then(data => {
      setPost(data || null)
      setLoading(false)
    })
  }, [slug])

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: MUTED }}>…</div>
  if (!post) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <p style={{ color: MUTED, marginBottom: 16 }}>{t.blog.notFound}</p>
      <button style={{ color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }} onClick={onBack}>{t.blog.goBack}</button>
    </div>
  )

  const title = lang === 'da' ? (post.title_da || post.title_en) : (post.title_en || post.title_da)
  const body = lang === 'da' ? (post.body_da || post.body_en) : (post.body_en || post.body_da)

  const s = {
    back: { color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, marginBottom: 24, padding: 0 },
    cover: { width: '100%', maxHeight: 400, objectFit: 'cover', borderRadius: 12, marginBottom: 28 },
    meta: { fontSize: 13, color: MUTED, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' },
    h1: { fontSize: 30, fontWeight: 700, color: TEXT, lineHeight: 1.25, margin: '0 0 20px' },
    body: { fontSize: 15, color: '#444', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    editBtn: { marginLeft: 'auto', fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'none', cursor: 'pointer', color: TEXT },
  }

  return (
    <div>
      <button style={s.back} onClick={onBack}>{t.blog.backToBlog}</button>
      {post.cover_image && <img src={post.cover_image} alt={title} style={s.cover} onError={e => { e.target.style.display = 'none' }} />}
      <div style={s.meta}>
        {post.author_name && <span>{t.blog.by} {post.author_name}</span>}
        {(post.published_at || post.created_at) && (
          <span>{t.blog.published}: {formatDate(post.published_at || post.created_at, lang)}</span>
        )}
        {isAdmin && <button style={s.editBtn} onClick={onEdit}>{t.blog.admin.edit}</button>}
      </div>
      <h1 style={s.h1}>{title}</h1>
      <div style={s.body}>{body}</div>
    </div>
  )
}

// ── Main Blog Page ────────────────────────────────────────────────────────────
export default function PublicBlogPage() {
  const [lang, setLang] = useState(() => detectLang())
  const t = getTranslations(lang)

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [slug, setSlug] = useState(() => {
    const m = window.location.pathname.match(/^\/blog\/(.+)$/)
    return m ? m[1] : null
  })
  const [editor, setEditor] = useState(null) // null | 'new' | post object

  async function load() {
    setLoading(true)
    // Try admin endpoint first to check if user is admin
    const adminRes = await apiFetchAdminBlogPosts()
    if (adminRes?.posts) {
      setPosts(adminRes.posts)
      setIsAdmin(true)
    } else {
      const res = await apiFetchBlogPosts()
      setPosts(res?.posts || [])
      setIsAdmin(false)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Update browser URL when slug changes
  useEffect(() => {
    const target = slug ? `/blog/${slug}` : '/blog'
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target)
    }
  }, [slug])

  // Handle browser back/forward
  useEffect(() => {
    function onPop() {
      const m = window.location.pathname.match(/^\/blog\/(.+)$/)
      setSlug(m ? m[1] : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const s = {
    page: { fontFamily: "'DM Sans', sans-serif", maxWidth: 860, margin: '0 auto', padding: '28px 20px 80px', color: TEXT },
    nav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 },
    brand: { fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: GREEN, textDecoration: 'none' },
    langBtn: { background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 },
    header: { marginBottom: 32 },
    h1: { fontSize: 32, fontWeight: 700, margin: '0 0 6px', color: TEXT },
    sub: { fontSize: 15, color: MUTED },
    adminBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f7f6f3', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 16px', marginBottom: 24 },
    adminLabel: { fontSize: 13, fontWeight: 600, color: TEXT },
    newBtn: { background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 },
    empty: { textAlign: 'center', padding: '60px 0', color: MUTED },
    footer: { textAlign: 'center', fontSize: 13, color: '#999', marginTop: 48 },
  }

  const editingPost = editor && editor !== 'new' ? editor : null
  const isNewEditor = editor === 'new'

  async function handleDelete(post) {
    if (!window.confirm(t.blog.admin.deleteConfirm)) return
    await apiDeleteBlogPost(post.id)
    await load()
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <a href="/" style={s.brand}>fellis.eu</a>
        <select style={s.langBtn} value={lang} onChange={e => setLang(e.target.value)} aria-label="Language">
          <option value="da">Dansk</option>
          <option value="en">English</option>
        </select>
      </nav>

      {/* Admin bar — only shown to admins, only on list view */}
      {isAdmin && !slug && (
        <div style={s.adminBar}>
          <span style={s.adminLabel}>{t.blog.admin.manage}</span>
          <button style={s.newBtn} onClick={() => setEditor('new')}>{t.blog.admin.newPost}</button>
        </div>
      )}

      {slug ? (
        <ArticleView
          key={slug}
          slug={slug}
          lang={lang}
          t={t}
          isAdmin={isAdmin}
          onBack={() => setSlug(null)}
          onEdit={() => {
            const p = posts.find(x => x.slug === slug)
            if (p) setEditor(p)
          }}
        />
      ) : (
        <>
          <div style={s.header}>
            <h1 style={s.h1}>{t.blog.title}</h1>
            <p style={s.sub}>{t.blog.subtitle}</p>
          </div>

          {loading ? (
            <div style={s.empty}>…</div>
          ) : posts.length === 0 ? (
            <div style={s.empty}>{t.blog.noPosts}</div>
          ) : (
            <div style={s.grid}>
              {posts.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  lang={lang}
                  t={t}
                  isAdmin={isAdmin}
                  onClick={() => setSlug(post.slug)}
                  onEdit={() => setEditor(post)}
                  onDelete={() => handleDelete(post)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div style={s.footer}>
        <p>fellis.eu — {lang === 'da' ? 'Dansk social platform hostet i EU' : 'Danish social platform hosted in the EU'}</p>
        <a href="/" style={{ color: GREEN, textDecoration: 'none' }}>{lang === 'da' ? '← Gå til fellis.eu' : '← Go to fellis.eu'}</a>
      </div>

      {(editor !== null) && (
        <BlogEditor
          post={isNewEditor ? null : editingPost}
          lang={lang}
          onCancel={() => setEditor(null)}
          onSave={async () => {
            setEditor(null)
            await load()
            // If editing current article, reload it by toggling slug
            if (editingPost && slug === editingPost.slug) {
              const newSlug = editingPost.slug
              setSlug(null)
              setTimeout(() => setSlug(newSlug), 0)
            }
          }}
        />
      )}
    </div>
  )
}
