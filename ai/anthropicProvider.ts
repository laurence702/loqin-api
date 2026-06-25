import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ClassifyResult, CoachInput, WeekReviewInput, SmartImportTask } from './provider'
import { CLASSIFY_PROMPT, COACH_PROMPT, WEEK_REVIEW_PROMPT, SMART_IMPORT_PROMPT, GOALS_EXTRACT_PROMPT, parseClassifyResponse, parseSmartImportResponse, stripThinkBlock } from './utils'

export class AnthropicProvider implements AIProvider {
  private client: Anthropic
  private modelClassify = 'claude-3-haiku-20240307'
  private modelCoach = 'claude-3-5-sonnet-latest'

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('Anthropic API key missing. Add ANTHROPIC_API_KEY to backend/.env or paste your key in Settings.')
    this.client = new Anthropic({ apiKey: key })
  }

  async classify(text: string, aiContext?: string): Promise<ClassifyResult> {
    const msg = await this.client.messages.create({
      model: this.modelClassify,
      max_tokens: 512,
      messages: [{ role: 'user', content: CLASSIFY_PROMPT(text, aiContext) }]
    })

    const raw = (msg.content[0] as any).text || ''
    return parseClassifyResponse(raw)
  }

  async coach(input: CoachInput): Promise<string> {
    try {
      const msg = await this.client.messages.create({
        model: this.modelCoach,
        max_tokens: 1024,
        messages: [{ role: 'user', content: COACH_PROMPT(input) }]
      })
      const raw = (msg.content[0] as any).text || ''
      return stripThinkBlock(raw).trim()
    } catch (err: any) {
      if (err.status === 404) {
        console.warn(`[anthropic] Coach model ${this.modelCoach} 404'd. Falling back to Haiku...`)
        const msg = await this.client.messages.create({
          model: this.modelClassify,
          max_tokens: 1024,
          messages: [{ role: 'user', content: COACH_PROMPT(input) }]
        })
        const raw = (msg.content[0] as any).text || ''
        return stripThinkBlock(raw).trim()
      }
      throw err
    }
  }

  async weekReview(input: WeekReviewInput): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.modelCoach,
      max_tokens: 512,
      messages: [{ role: 'user', content: WEEK_REVIEW_PROMPT(input) }]
    })
    return stripThinkBlock((msg.content[0] as any).text || '').trim()
  }

  async smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]> {
    const msg = await this.client.messages.create({
      model: this.modelClassify,
      max_tokens: 2048,
      messages: [{ role: 'user', content: SMART_IMPORT_PROMPT(text, aiContext) }]
    })

    const raw = (msg.content[0] as any).text || ''
    return parseSmartImportResponse(raw)
  }

  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Transcription not supported by Anthropic provider')
  }

  async extractGoals(text: string): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.modelCoach,
      max_tokens: 256,
      messages: [{ role: 'user', content: GOALS_EXTRACT_PROMPT(text) }]
    })
    return stripThinkBlock((msg.content[0] as any).text || '').trim()
  }
}
