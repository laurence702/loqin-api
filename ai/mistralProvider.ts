import { AIProvider, ClassifyResult, CoachInput, WeekReviewInput, SmartImportTask } from './provider'
import { CLASSIFY_PROMPT, COACH_PROMPT, WEEK_REVIEW_PROMPT, SMART_IMPORT_PROMPT, GOALS_EXTRACT_PROMPT, parseClassifyResponse, parseSmartImportResponse, stripThinkBlock } from './utils'

export class MistralProvider implements AIProvider {
  private apiKey: string
  private model: string

  constructor(apiKey?: string) {
    const key = apiKey || process.env.MISTRAL_API_KEY
    if (!key) throw new Error('Mistral API key missing. Add MISTRAL_API_KEY to backend/.env or paste your key in Settings.')
    this.apiKey = key
    this.model = process.env.MISTRAL_MODEL || 'mistral-large-latest'
  }

  async classify(text: string, aiContext?: string): Promise<ClassifyResult> {

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: CLASSIFY_PROMPT(text, aiContext) }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) throw new Error(`Mistral error: ${response.status}`)
    const data = await response.json() as any
    const raw = data.choices[0].message.content
    return parseClassifyResponse(raw)
  }

  async coach(input: CoachInput): Promise<string> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: COACH_PROMPT(input) }],
        temperature: 0.7
      })
    })

    if (!response.ok) throw new Error(`Mistral error: ${response.status}`)
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }

  async weekReview(input: WeekReviewInput): Promise<string> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: WEEK_REVIEW_PROMPT(input) }], temperature: 0.7 })
    })
    if (!response.ok) throw new Error(`Mistral error: ${response.status}`)
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }

  async smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: SMART_IMPORT_PROMPT(text, aiContext) }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) throw new Error(`Mistral error: ${response.status}`)
    const data = await response.json() as any
    const raw = (data.choices[0].message as any).content
    return parseSmartImportResponse(raw)
    }

  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Transcription not supported by Mistral provider')
  }

  async extractGoals(text: string): Promise<string> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: GOALS_EXTRACT_PROMPT(text) }], temperature: 0.5, max_tokens: 256 })
    })
    if (!response.ok) throw new Error(`Mistral error: ${response.status}`)
    const data = await response.json() as any
    return stripThinkBlock(data.choices[0].message.content).trim()
  }
}
