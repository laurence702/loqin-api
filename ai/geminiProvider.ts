import { AIProvider, ClassifyResult, CoachInput, WeekReviewInput, SmartImportTask } from './provider'
import { CLASSIFY_PROMPT, COACH_PROMPT, WEEK_REVIEW_PROMPT, SMART_IMPORT_PROMPT, GOALS_EXTRACT_PROMPT, parseClassifyResponse, parseSmartImportResponse, stripThinkBlock } from './utils'

export class GeminiProvider implements AIProvider {
  private apiKey: string
  private model: string

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY
    if (!key) throw new Error('Gemini API key missing. Add GEMINI_API_KEY to backend/.env or paste your key in Settings.')
    this.apiKey = key
    this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  }

  private async fetchWithRetry(url: string, body: any, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (response.status === 429 && i < retries) {
          console.warn(`[gemini] Rate limited (429). Retrying in 1s... (${i + 1}/${retries})`)
          await new Promise(r => setTimeout(r, 1000 * (i + 1)))
          continue
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({})) as any
          throw new Error(`Gemini error (${response.status}): ${errData.error?.message || 'Unknown error'}`)
        }

        return response.json()
      } catch (err: any) {
        if (i === retries) throw err
        console.warn(`[gemini] Attempt ${i + 1} failed: ${err.message}. Retrying...`)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  async classify(text: string, aiContext?: string): Promise<ClassifyResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = {
      contents: [{ parts: [{ text: CLASSIFY_PROMPT(text, aiContext) }] }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json',
      }
    }

    const data = await this.fetchWithRetry(url, body)
    const raw = data.candidates[0].content.parts[0].text
    return parseClassifyResponse(raw)
  }

  async coach(input: CoachInput): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = {
      contents: [{ parts: [{ text: COACH_PROMPT(input) }] }],
      generationConfig: { temperature: 0.7 }
    }

    const data = await this.fetchWithRetry(url, body)
    return stripThinkBlock(data.candidates[0].content.parts[0].text).trim()
  }

  async weekReview(input: WeekReviewInput): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = { contents: [{ parts: [{ text: WEEK_REVIEW_PROMPT(input) }] }], generationConfig: { temperature: 0.7 } }
    const data = await this.fetchWithRetry(url, body)
    return stripThinkBlock(data.candidates[0].content.parts[0].text).trim()
  }

  async smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = {
      contents: [{ parts: [{ text: SMART_IMPORT_PROMPT(text, aiContext) }] }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: 'application/json',
      }
    }

    const data = await this.fetchWithRetry(url, body)
    const raw = data.candidates[0].content.parts[0].text
    return parseSmartImportResponse(raw)
  }

  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Transcription not supported by Gemini provider')
  }

  async extractGoals(text: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
    const body = { contents: [{ parts: [{ text: GOALS_EXTRACT_PROMPT(text) }] }], generationConfig: { temperature: 0.5 } }
    const data = await this.fetchWithRetry(url, body)
    return stripThinkBlock(data.candidates[0].content.parts[0].text).trim()
  }
}
