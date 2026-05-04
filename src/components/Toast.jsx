export default function Toast({ message, visible }) {
  return (
    <div className={`fellis-toast${visible ? ' visible' : ''}`}>
      ✓ {message}
    </div>
  )
}
