import type { AIProvider, ClassifyResult, CoachInput, WeekReviewInput, SmartImportTask } from './provider'
import { CLASSIFY_PROMPT, COACH_PROMPT, WEEK_REVIEW_PROMPT, SMART_IMPORT_PROMPT, GOALS_EXTRACT_PROMPT, parseClassifyResponse, parseSmartImportResponse, stripThinkBlock } from './utils'

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const MODEL    = process.env.OLLAMA_MODEL    || 'deepseek-r1:8b'

export class OllamaProvider implements AIProvider {
  private baseUrl = BASE_URL
  private modelClassify = MODEL

  async classify(text: string, aiContext?: string): Promise<ClassifyResult> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelClassify,
        prompt: CLASSIFY_PROMPT(text, aiContext),
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 250 }
      })
    })

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as { response: string }
    return parseClassifyResponse(data.response)
  }

  async coach(input: CoachInput): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: COACH_PROMPT(input),
        stream: false,
        options: { temperature: 0.7 }
      })
    })

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as { response: string }
    return stripThinkBlock(data.response).trim()
  }

  async weekReview(input: WeekReviewInput): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: WEEK_REVIEW_PROMPT(input), stream: false, options: { temperature: 0.7 } })
    })
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as { response: string }
    return stripThinkBlock(data.response).trim()
  }

  async smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelClassify,
        prompt: SMART_IMPORT_PROMPT(text, aiContext),
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_predict: 1000 }
      })
    })

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as { response: string }
    return parseSmartImportResponse(data.response)
  }

  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Transcription not supported by Ollama provider')
  }

  async extractGoals(text: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelClassify, prompt: GOALS_EXTRACT_PROMPT(text), stream: false, options: { temperature: 0.5, num_predict: 256 } })
    })
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as { response: string }
    return stripThinkBlock(data.response).trim()
  }
}

