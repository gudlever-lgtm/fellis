import { getTheme, CONTEXT_TO_THEME } from './userTypeTheme.js'
import { getInitials } from './data.js'

export default function PostCard({
  post,
  viewerMode,
  t,
  lang,
  isOwn,
  onViewProfile,
  onViewOwnProfile,
  onViewBadges,
  nameSuffix,
  timeContent,
  menuContent,
  children,
  ...rest
}) {
  const authorMode = post.authorMode || post.author_mode || 'privat'
  const theme = getTheme(authorMode)
  const authorName = post.author || post.author_name || ''
  const authorId = post.authorId || post.author_id
  const badgeCount = post.authorBadgeCount || 0

  const postContext = post.postContext || post.post_context || 'social'
  const contextKey = CONTEXT_TO_THEME[postContext] || 'private'
  const contextLabel = t?.post?.badge?.[contextKey] || postContext

  const subtitle = authorMode === 'business'
    ? (post.businessCategory || post.business_category || null)
    : authorMode === 'network'
    ? (post.professionalTitle || post.professional_title || null)
    : null

  const handleAvatarClick = () => {
    if (isOwn) onViewOwnProfile?.()
    else if (authorId) onViewProfile?.(authorId)
  }

  return (
    <div
      className="p-card p-post"
      style={{
        background: theme.colorLight,
        border: `${theme.borderWidth} solid ${theme.color}`,
        borderTop: `3px solid ${theme.color}`,
      }}
      {...rest}
    >
      <div style={s.badgeRow}>
        <span style={{ background: theme.badgeBg, color: theme.badgeText, ...s.badge }}>
          {contextLabel}
        </span>
      </div>
      <div style={s.header}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: theme.avatarRadius,
              background: theme.avatarBg,
              color: theme.avatarText,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              userSelect: 'none',
              flexShrink: 0,
              overflow: 'hidden',
            }}
            onClick={handleAvatarClick}
            title={authorName}
          >
            {authorName ? getInitials(authorName) : '?'}
          </div>
          {badgeCount > 0 && (
            <span
              onClick={() => onViewBadges?.(isOwn ? null : authorId)}
              style={{
                position: 'absolute',
                bottom: -3,
                right: -6,
                fontSize: 9,
                fontWeight: 700,
                background: '#FFD700',
                color: '#7a5f00',
                borderRadius: 7,
                padding: '0 3px',
                lineHeight: '13px',
                border: '1.5px solid #fff',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                zIndex: 1,
              }}
            >
              🏅{badgeCount}
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="p-post-author"
              style={{ cursor: 'pointer', color: theme.colorDark }}
              onClick={handleAvatarClick}
            >
              {authorName}
            </span>
            {nameSuffix}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: theme.colorDark, opacity: 0.8, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
          {timeContent}
        </div>
        {menuContent}
      </div>
      {children}
    </div>
  )
}

const s = {
  badgeRow: {
    marginBottom: 8,
  },
  badge: {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 8,
    padding: '2px 8px',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
}
