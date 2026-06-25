import { CoachInput, WeekReviewInput, ClassifyResult, SmartImportTask } from './provider'

/** Strip DeepSeek R1's <think>...</think> reasoning block before parsing JSON */
export function stripThinkBlock(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/** Extract the first valid JSON object from a string (handles surrounding text) */
export function extractJSON(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in response')
  return match[0]
}

/** Extract the first valid JSON array from a string */
export function extractJSONArray(raw: string): string {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found in response')
  return match[0]
}

export const CLASSIFY_PROMPT = (text: string, aiContext?: string) => `You are an expert productivity classifier for a high-performance founder.
Classify this task using the Signal/Noise framework. Be rigorous but fair.

Task: "${text}"

${aiContext && aiContext.trim().length > 0 ? `User's Personal Context & Long-Term Goals:\n"""\n${aiContext}\n"""\nIMPORTANT: Take this context heavily into account. Tasks aligning with these long-term goals are highly likely to be SIGNAL, even if they might ordinarily seem like noise or hobbies to a generic classifier.\n` : ''}
Context: This user is building startups and managing high-stakes work. Strategic conversations,
business calls, relationships, planning, and anything with long-term wealth or leverage potential
are strong signals. Pure busywork, entertainment, and admin with no leverage are noise.

Apply these 3 questions honestly:
Q1: Does completing this unblock someone else or create leverage beyond just me?
Q2: Will I genuinely regret skipping this in 3 months — not 3 days?
Q3: Can only I do this — not a template, AI, junior, or tool?

Scoring: 2-3 YES = signal. 0-1 YES = noise. Apply the questions, don't guess — reason carefully.

Respond ONLY with valid JSON, nothing else, no markdown fences:
{"type":"signal","reason":"<one direct sentence explaining why>","q1":true,"q2":true,"q3":false}`

export const COACH_PROMPT = (input: CoachInput) => {
  const reflectionSection = input.pastReflections && input.pastReflections.length > 0
    ? `\nUser's recent reflections (last ${input.pastReflections.length} days — use to spot patterns):\n${input.pastReflections.map((r, i) => `Day -${input.pastReflections!.length - i}: "${r}"`).join('\n')}\n`
    : ''

  return `You are a brutal, direct focus coach. Give a coaching note in 2-3 sentences MAX based on this user's workday:

SNR Score: ${input.snrPct}% (target: 75%+)
Signal tasks: ${input.signalTasks.length} (${input.signalsDone} completed)
Noise tasks: ${input.noiseTasks.length}
Time in noise: ${Math.floor(input.noiseSeconds / 60)} minutes (budget: 45 min)
Signals: ${input.signalTasks.join(', ') || 'none'}
Noise: ${input.noiseTasks.join(', ') || 'none'}
${reflectionSection}
Be specific and reference their actual numbers. If past reflections reveal a recurring pattern (same noise source, same struggle), call it out by name — patterns that persist deserve a direct intervention. End with ONE concrete action for tomorrow. Confident tone, not preachy.`
}

export function parseClassifyResponse(raw: string): ClassifyResult {
  const cleaned = stripThinkBlock(raw)
  try {
    const jsonStr = extractJSON(cleaned)
    const parsed  = JSON.parse(jsonStr)
    return {
      type:   parsed.type === 'signal' ? 'signal' : 'noise',
      reason: parsed.reason || 'No reason provided.',
      q1: Boolean(parsed.q1),
      q2: Boolean(parsed.q2),
      q3: Boolean(parsed.q3)
    }
  } catch (e: any) {
    throw new Error(`Parse error: ${e.message} | Raw: ${raw.slice(0, 100)}`)
  }
}

export const SMART_IMPORT_PROMPT = (text: string, aiContext?: string) => `You are an expert productivity classifier for a high-performance founder.
The user has provided a raw text dump (can be meeting notes, unorganized checklists, or messy text).
Your goal is to extract ALL distinct, actionable tasks from this text and classify them.

Raw Text:
"""
${text}
"""

${aiContext && aiContext.trim().length > 0 ? `User's Personal Context & Long-Term Goals:\n"""\n${aiContext}\n"""\nIMPORTANT: Take this context heavily into account. Tasks aligning with these long-term goals are highly likely to be SIGNAL, even if they might ordinarily seem like noise or hobbies to a generic classifier.\n` : ''}
Instructions:
1. Extract every actionable task from the text. Make the task title concise, clear, and actionable.
2. For each task, classify it as "signal" (high leverage, unblocking, long-term impact) or "noise" (busywork, trivial, delegatable, admin).
3. Provide a very short 1-sentence reason for the classification.
4. If no actionable tasks are found, return an empty array [].

Respond ONLY with valid JSON representing an array of objects. Do not include markdown formatting or reasoning outside the JSON.
Format example:
[
  { "text": "Schedule Q3 review with engineering", "type": "signal", "reason": "Unblocks the team and aligns long-term sprint goals." },
  { "text": "Reply to generic cold email", "type": "noise", "reason": "Zero leverage output. Pure busywork." }
]`

export const WEEK_REVIEW_PROMPT = (input: WeekReviewInput): string => {
  const rows = input.days.map(d => {
    const ref = d.reflection_answer
      ? `, reflection: "${d.reflection_answer.slice(0, 120).replace(/\n/g, ' ')}"`
      : ''
    return `  ${d.date}: SNR ${d.snr_pct}%${ref}`
  }).join('\n')

  return `You are a strategic focus coach. A user has shared their last 7 days of productivity data. Write a Week in Review in exactly 3-4 sentences covering:
1. The SNR trend across the week (improving / declining / volatile — cite the actual numbers)
2. The most frequently mentioned noise source from their reflections, if any — name it directly
3. ONE specific, actionable recommendation for next week to improve signal focus

Last 7 days:
${rows}

Rules: Be specific and cite actual percentages. Brutal-but-constructive tone. No bullet points or headers. Plain text only.`
}

export const GOALS_EXTRACT_PROMPT = (text: string): string =>
  `You are a strategic clarity coach. A user has uploaded a document describing their long-term goals and projects.

Document content:
"""
${text.slice(0, 4000)}
"""

Extract 3-5 core long-term goals or focus themes from this document. Write them as a clear, concise paragraph (2-4 sentences) in first person — exactly as the user would write it themselves in a "Personal AI Context & Goals" field.

Rules:
- Be specific. Reference real projects, skills, or outcomes from the document.
- First person only ("I am building...", "My goal is...").
- Plain text only. No bullet points, no headers, no markdown.
- Maximum 120 words.`

export function parseSmartImportResponse(raw: string): SmartImportTask[] {
  const cleaned = stripThinkBlock(raw)
  try {
    const jsonStr = extractJSONArray(cleaned)
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) throw new Error("Parsed JSON is not an array")
    
    return parsed.map((p: any) => ({
      text: p.text || 'Untitled task',
      type: p.type === 'signal' ? 'signal' : 'noise',
      reason: p.reason || 'No reason provided.'
    }))
  } catch (e: any) {
    throw new Error(`Smart Import Parse error: ${e.message} | Raw: ${raw.slice(0, 100)}`)
  }
}

