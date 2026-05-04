import StoryBar from './StoryBar.jsx'

export default function Stories({ currentUser, lang }) {
  const design = localStorage.getItem('fellis_design') || 'classic'
  if (design !== 'new') return null

  return (
    <div className="stories-strip-wrapper">
      <StoryBar currentUser={currentUser} lang={lang} />
    </div>
  )
}
