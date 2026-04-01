import { useState, useEffect } from 'react'
import { apiGetCompanyQA, apiAskCompanyQuestion, apiAnswerCompanyQuestion, apiDeleteCompanyQuestion } from '../api.js'
import { nameToColor, getInitials } from '../data.js'

export default function CompanyQA({ companyId, currentUserId, isMember, lang }) {
  const [questions, setQuestions] = useState(null)
  const [newQuestion, setNewQuestion] = useState('')
  const [answerDraft, setAnswerDraft] = useState({})
  const [showAnswerFor, setShowAnswerFor] = useState(null)
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? { title: 'Spørgsmål & svar', ask: 'Stil et spørgsmål', askPh: 'Stil et spørgsmål til virksomheden…', send: 'Send', answer: 'Svar', answerPh: 'Skriv svar…', save: 'Gem svar', cancel: 'Annuller', empty: 'Ingen spørgsmål endnu.', unanswered: 'Ikke besvaret endnu' }
    : { title: 'Q&A', ask: 'Ask a question', askPh: 'Ask the company a question…', send: 'Send', answer: 'Answer', answerPh: 'Write an answer…', save: 'Save answer', cancel: 'Cancel', empty: 'No questions yet.', unanswered: 'Not yet answered' }

  const load = () => apiGetCompanyQA(companyId).then(d => setQuestions(d?.questions || []))

  useEffect(() => { load() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAsk = async () => {
    if (!newQuestion.trim()) return
    setSaving(true)
    await apiAskCompanyQuestion(companyId, newQuestion)
    setNewQuestion('')
    await load()
    setSaving(false)
  }

  const handleAnswer = async (qaId) => {
    const answer = answerDraft[qaId]
    if (!answer?.trim()) return
    await apiAnswerCompanyQuestion(companyId, qaId, answer)
    setAnswerDraft(prev => ({ ...prev, [qaId]: '' }))
    setShowAnswerFor(null)
    load()
  }

  const handleDelete = async (qaId) => {
    if (!confirm(lang === 'da' ? 'Slet dette spørgsmål?' : 'Delete this question?')) return
    await apiDeleteCompanyQuestion(companyId, qaId)
    load()
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>💬 {t.title}</h3>

      <div style={{ marginBottom: 16 }}>
        <textarea
          placeholder={t.askPh}
          value={newQuestion}
          onChange={e => setNewQuestion(e.target.value)}
          rows={2}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border,#ddd)', fontSize: 14, resize: 'none', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <button onClick={handleAsk} disabled={saving || !newQuestion.trim()}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          {saving ? '…' : t.send}
        </button>
      </div>

      {!questions && <div style={{ color: '#888' }}>…</div>}
      {questions?.length === 0 && <div style={{ color: '#888', fontSize: 14 }}>{t.empty}</div>}

      {questions?.map(q => (
        <div key={q.id} className="p-card" style={{ marginBottom: 12, padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: nameToColor(q.asker_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {q.asker_avatar
                ? <img src={q.asker_avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : getInitials(q.asker_name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>❓ {q.question}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{q.asker_name}</div>
              {q.answer ? (
                <div style={{ marginTop: 10, background: 'var(--bg,#f9fafb)', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700, color: '#1877F2', marginRight: 6 }}>💼 {q.answerer_name}:</span>
                  {q.answer}
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, color: '#bbb' }}>{t.unanswered}</div>
              )}
              {isMember && !q.answer && (
                showAnswerFor === q.id ? (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      placeholder={t.answerPh}
                      value={answerDraft[q.id] || ''}
                      onChange={e => setAnswerDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                      rows={2}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, resize: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleAnswer(q.id)}
                        style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                        {t.save}
                      </button>
                      <button onClick={() => setShowAnswerFor(null)}
                        style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowAnswerFor(q.id)}
                    style={{ marginTop: 6, padding: '5px 12px', borderRadius: 7, border: '1px solid #1877F2', background: 'transparent', color: '#1877F2', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    {t.answer}
                  </button>
                )
              )}
            </div>
            {(q.asker_id === currentUserId || isMember) && (
              <button onClick={() => handleDelete(q.id)}
                style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>✕</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
