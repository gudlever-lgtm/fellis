import Mistral from '@mistralai/mistralai'

const SYSTEM_PROMPT = `You are a content moderation assistant for a social platform.
Analyze the provided text and respond with ONLY valid JSON containing exactly these fields:
- "safe": boolean — true if acceptable, false if it should be flagged
- "reason": string or null — brief reason if not safe, null if safe
- "confidence": "low", "medium", or "high"

Flag: hate speech, harassment, explicit sexual content, graphic violence, spam, illegal content.
Allow: normal social interactions, mild language, legitimate business content, debate, satire.`

let _client = null

function getClient() {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) return null
  if (!_client) _client = new Mistral({ apiKey })
  return _client
}

export async function moderateContent(text, contentType) {
  const client = getClient()
  if (!client) {
    console.warn('[moderation] MISTRAL_API_KEY not set — defaulting to safe')
    return { safe: true, reason: null, confidence: 'low' }
  }

  try {
    const callPromise = client.chat.complete({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Content type: ${contentType}\n\n${text}` },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
      maxTokens: 200,
    })
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 1500)
    )
    const response = await Promise.race([callPromise, timeoutPromise])

    const raw = response.choices?.[0]?.message?.content?.trim()
    if (!raw) {
      console.error('[moderation] Empty response from Mistral')
      return { safe: true, reason: null, confidence: 'low' }
    }

    const parsed = JSON.parse(raw)
    return {
      safe: typeof parsed.safe === 'boolean' ? parsed.safe : true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : null,
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low',
    }
  } catch (err) {
    console.error('[moderation] Mistral error:', err.message)
    return { safe: true, reason: null, confidence: 'low' }
  }
}
