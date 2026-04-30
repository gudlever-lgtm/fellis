const MISTRAL_MODERATION_URL = 'https://api.mistral.ai/v1/moderations'

export async function moderateGroupContent(name, description) {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    console.warn('[group-moderation] MISTRAL_API_KEY not set — skipping moderation')
    return { flagged: false, categories: {} }
  }

  const input = `${name}\n${description || ''}`.trim()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(MISTRAL_MODERATION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-moderation-latest',
        input: [input],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      console.error(`[group-moderation] Mistral API error: ${response.status}`)
      return { flagged: false, categories: {} }
    }

    const data = await response.json()
    const result = data.results?.[0]
    if (!result) return { flagged: false, categories: {} }

    return {
      flagged: result.flagged === true,
      categories: result.categories || {},
    }
  } catch (err) {
    console.error('[group-moderation] Error calling Mistral:', err.message)
    return { flagged: false, categories: {} }
  }
}
