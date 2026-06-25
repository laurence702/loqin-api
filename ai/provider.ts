import { OllamaProvider } from './ollamaProvider'
import { AnthropicProvider } from './anthropicProvider'
import { OpenAIProvider } from './openaiProvider'
import { GeminiProvider } from './geminiProvider'
import { MistralProvider } from './mistralProvider'
import { GroqProvider } from './groqProvider'

export interface ClassifyResult {
  type: 'signal' | 'noise' | 'unclassified'
  reason: string
  q1: boolean
  q2: boolean
  q3: boolean
  error?: boolean
}

export interface CoachInput {
  snrPct: number
  signalTasks: string[]
  noiseTasks: string[]
  noiseSeconds: number
  signalsDone: number
  pastReflections?: string[]   // last N days of reflection_answer for continuity
}

export interface SmartImportTask {
  text: string
  type: 'signal' | 'noise'
  reason: string
}

export interface WeekReviewInput {
  days: Array<{
    date: string
    snr_pct: number
    reflection_answer?: string | null
    coaching_note?: string | null
  }>
}

export interface AIProvider {
  classify(text: string, aiContext?: string): Promise<ClassifyResult>
  coach(input: CoachInput): Promise<string>
  weekReview(input: WeekReviewInput): Promise<string>
  smartImport(text: string, aiContext?: string): Promise<SmartImportTask[]>
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>
  extractGoals(text: string): Promise<string>
}

/**
 * Resolve an AIProvider instance.
 *
 * Resolution order for the provider name:
 *   1. `override` (sent by the client, e.g. detected from the user's key)
 *   2. AI_PROVIDER env var
 *   3. 'ollama' (local fallback)
 *
 * Resolution order for the API key:
 *   1. `apiKey` passed from the client (user's BYOK key)
 *   2. The matching *_API_KEY env var inside each provider's constructor
 */
export function getProvider(override?: string, apiKey?: string): AIProvider {
  const provider = (override || process.env.AI_PROVIDER || 'ollama').toLowerCase()
  const src = override ? '(client-detected)' : '(env default)'
  const keySrc = apiKey ? ' + user key' : ''
  console.log(`[ai-proxy] Provider: ${provider} ${src}${keySrc}`)

  switch (provider) {
    case 'openai':    return new OpenAIProvider(apiKey)
    case 'anthropic': return new AnthropicProvider(apiKey)
    case 'gemini':    return new GeminiProvider(apiKey)
    case 'mistral':   return new MistralProvider(apiKey)
    case 'groq':      return new GroqProvider(apiKey)
    case 'ollama':    return new OllamaProvider()
    default:
      console.warn(`[ai-proxy] Unknown provider "${provider}", falling back to Ollama`)
      return new OllamaProvider()
  }
}
