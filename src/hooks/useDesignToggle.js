import { useState, useCallback } from 'react'

export default function useDesignToggle() {
  const [design, setDesign] = useState(() => localStorage.getItem('fellis_design') || 'classic')

  const toggleDesign = useCallback(() => {
    const next = design === 'classic' ? 'new' : 'classic'
    localStorage.setItem('fellis_design', next)
    setDesign(next)
  }, [design])

  return { design, toggleDesign }
}
