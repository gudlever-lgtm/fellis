/**
 * ModeGate — renders children only when `mode` matches the current platform mode.
 * Usage: <ModeGate mode="common" currentMode={mode}>...</ModeGate>
 *
 * Falls back to the `fallback` prop (default: null) when mode doesn't match.
 */
// "common" is an alias for "privat" (non-business users)
function normalise(m) { return m === 'common' ? 'privat' : m }

export default function ModeGate({ mode, currentMode, children, fallback = null }) {
  if (currentMode !== normalise(mode)) return fallback
  return children
}
