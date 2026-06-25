import { AIProvider, ClassifyResult, CoachInput, WeekReviewInput, SmartImportTask } from './provider'
import { CLASSIFY_PROMPT, COACH_PROMPT, WEEK_REVIEW_PROMPT, SMART_IMPORT_PROMPT, GOALS_EXTRACT_PROMPT, parseClassifyResponse, parseSmartImportResponse, stripThinkBlock } from './utils'

export class GroqProvider implements AIProvider {
  private apiKey: string
  private modelClassify = 'llama-3.3-70b-versatile'
  private modelCoach = 'llama-3.3-70b-versatile'

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GROQ_API_KEY
    if (!key) throw new Error('Groq API key missing. Add GROQ_API_KEY to backend/.env or paste your key in Settings.')
    this.apiKey = key
  }

  async classify(text: string, aiContext?: string): Promise<ClassifyResult> {

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelClassify,
        messages: [{ role: 'user', content: CLASSIFY_PROMPT(text, aiContext) }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as any
      const msg = body?.error?.message || response.statusText
      throw new Error(`Groq ${response.status}: ${msg}`)
    }
    const data = await response.json() as any
    const raw = data.choices[0].message.content
    return parseClassifyResponse(raw)
  }

  async coach(input: CoachInput): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelCoach,
        messages: [{ role: 'user', content: COACH_PROMPT(input) }],
        temperature: 0.7
      })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as any
      const msg = body?.error?.message || response.statusText
      throw new Error(`Groq ${response.status}: ${msg}`)
    }
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }

  async weekReview(input: WeekReviewInput): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelCoach, messages: [{ role: 'user', content: WEEK_REVIEW_PROMPT(input) }], temperature: 0.7 })
    })
    if (!response.ok) { const b = await response.json().catch(() => ({})) as any; throw new Error(`Groq ${response.status}: ${b?.error?.message || response.statusText}`) }
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }

  async smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelClassify,
        messages: [{ role: 'user', content: SMART_IMPORT_PROMPT(text, aiContext) }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as any
      const msg = body?.error?.message || response.statusText
      throw new Error(`Groq ${response.status}: ${msg}`)
    }
    const data = await response.json() as any
    const raw = data.choices[0].message.content
    return parseSmartImportResponse(raw)
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.apiKey) throw new Error('GROQ_API_KEY is missing')

    const formData = new FormData()
    const file = new Blob([audioBuffer], { type: mimeType })
    formData.append('file', file, 'audio.webm')
    formData.append('model', 'whisper-large-v3')

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Groq Whisper error: ${response.status} | ${errorText}`)
    }

    const data = await response.json() as { text: string }
    return data.text
  }

  async extractGoals(text: string): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelCoach, messages: [{ role: 'user', content: GOALS_EXTRACT_PROMPT(text) }], temperature: 0.5, max_tokens: 256 })
    })
    if (!response.ok) { const b = await response.json().catch(() => ({})) as any; throw new Error(`Groq ${response.status}: ${b?.error?.message || response.statusText}`) }
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }
}

