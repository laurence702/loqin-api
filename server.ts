import * as Sentry from '@sentry/node'
import 'dotenv/config'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development'
})

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import multer from 'multer'
import pdfParse from 'pdf-parse'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { getProvider } from './ai/provider'
import type { WeekReviewInput } from './ai/provider'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '')
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[backend] WARNING: STRIPE_SECRET_KEY is not defined')
}
if (!process.env.STRIPE_PRICE_ID) {
  console.warn('[backend] WARNING: STRIPE_PRICE_ID is not defined — checkout will fail')
}

// ── App base URL (used for Stripe redirect URLs) ──────────────────────────────
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[backend] WARNING: Supabase credentials are not fully configured')
}


const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      'http://localhost:5173',   // Vite web dev
      'app://lockin',            // Electron
      'capacitor://localhost',   // Capacitor iOS
      'http://localhost',        // Capacitor Android
    ]

app.use(cors({ origin: ALLOWED_ORIGINS }))

// We need the raw body for Stripe webhook signature verification
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err: any) {
    console.error(`[webhook error] ${err.message}`)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the event
  console.log(`[stripe event] ${event.type}`)
  
  // ── Feature #2: subscription cancelled → revoke Pro ──────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string
    console.log(`🚫 Subscription deleted for customer: ${customerId}`)

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_customer_id', customerId)

    if (error) {
      console.error(`[webhook] subscription.deleted db error: ${error.message}`)
    } else {
      console.log(`✅ Subscription marked canceled — sync_is_premium trigger will flip is_premium=false`)
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.client_reference_id
    const customerId = session.customer as string
    const subscriptionId = session.subscription as string

    console.log(`💰 Payment success for user: ${userId}`)
    
    // Update the subscriptions table (RLS is bypassed via service_role)
    const { error: subError } = await supabaseAdmin
      .from('subscriptions')
      .upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        price_id: session.line_items?.data[0]?.price?.id || process.env.STRIPE_PRICE_ID
      })

    if (subError) {
      console.error(`[webhook db error] ${subError.message}`)
    } else {
      console.log(`✅ Subscription finalized for ${userId}`)
    }
  }

  res.json({ received: true })
})

app.use(express.json())

console.log('[backend] Env Check - ANTHROPIC_API_KEY exists:', !!process.env.ANTHROPIC_API_KEY)
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[backend] WARNING: ANTHROPIC_API_KEY is not defined in process.env')
}

const PORT = process.env.PORT || 3002

// ── PRO GATE MIDDLEWARE ───────────────────────────────────────────────────────
/**
 * Verify the request comes from an active Pro subscriber.
 * BYOK requests (api_key present in body) bypass the gate — the user is
 * consuming their own API quota, not the server's.
 */
async function requirePro(req: Request, res: Response, next: NextFunction) {
  // BYOK: user supplied their own key → no server resources used, skip gate
  if (req.body?.api_key) return next()

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'Pro required' })
  }
  const token = authHeader.split(' ')[1]

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Invalid token' })

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()

    if (sub?.status !== 'active') {
      return res.status(403).json({ error: 'Pro required' })
    }

    // Attach user id for downstream handlers if needed
    ;(req as any).userId = user.id
    next()
  } catch (err: any) {
    console.error('[requirePro] error:', err.message)
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    provider: process.env.AI_PROVIDER || 'ollama',
    model: process.env.OLLAMA_MODEL || 'deepseek-r1:8b',
    timestamp: new Date().toISOString()
  })
})

// ── TEST KEY ──────────────────────────────────────────────────────────────────
app.post('/api/test-key', async (req, res) => {
  const { provider: providerOverride, api_key } = req.body as {
    provider?: string; api_key?: string
  }
  console.log('[test-key] Testing provider:', providerOverride, '| key present:', !!api_key)
  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    // Minimal classify call to verify connectivity + key validity
    const result = await provider.classify('Write the quarterly report', undefined)
    res.json({
      ok: true,
      provider: providerOverride || process.env.AI_PROVIDER || 'ollama',
      sample: result.type   // 'signal' | 'noise' | 'unclassified'
    })
  } catch (err: any) {
    res.json({ ok: false, error: err.message })
  }
})

// ── CLASSIFY TASK ─────────────────────────────────────────────────────────────
app.post('/api/classify', requirePro, async (req, res) => {
  const { text, provider: providerOverride, ai_context, api_key } = req.body as {
    text: string; provider?: string; ai_context?: string; api_key?: string
  }
  if (!text) return res.status(400).json({ error: 'Missing text' })

  // ── DEBUG ─────────────────────────────────────────────────────────────────
  console.log('[classify] ← request body:', {
    text: text.slice(0, 60),
    provider: providerOverride ?? '(not set)',
    api_key: api_key ? `${api_key.slice(0, 8)}… (len=${api_key.length})` : '(not set)',
    ai_context: ai_context ? ai_context.slice(0, 40) + '…' : '(not set)',
  })
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    const result = await provider.classify(text.trim(), ai_context)
    console.log('[classify] → result:', result)
    res.json(result)
  } catch (err: any) {
    console.error('[classify] ✗ error:', err.message)
    console.error('[classify] ✗ full error:', err)
    // Graceful degradation — never block the user from adding a task
    res.status(200).json({
      type: 'unclassified',
      reason: `AI unavailable (${err.message}) — please classify manually.`,
      q1: false,
      q2: false,
      q3: false,
      error: true
    })
  }
})

// ── SMART IMPORT ──────────────────────────────────────────────────────────────
app.post('/api/smart-import', requirePro, async (req, res) => {
  const { text, provider: providerOverride, ai_context, api_key } = req.body as {
    text: string; provider?: string; ai_context?: string; api_key?: string
  }
  if (!text) return res.status(400).json({ error: 'Missing text' })

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    const result = await provider.smartImport(text.trim(), ai_context)
    res.json(result)
  } catch (err: any) {
    console.error('[smart-import error]', err.message)
    res.status(500).json({ error: 'Failed to process smart import', details: err.message })
  }
})

// ── VOICE TO TASKS ────────────────────────────────────────────────────────────
app.post('/api/voice-to-tasks', requirePro, upload.single('audio'), async (req, res) => {
  const { provider: providerOverride, ai_context, api_key } = req.body as {
    provider?: string; ai_context?: string; api_key?: string
  }
  if (!req.file) return res.status(400).json({ error: 'Missing audio file' })

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    
    // 1. Transcribe
    console.log(`[voice] Transcribing ${req.file.size} bytes...`)
    const text = await provider.transcribe(req.file.buffer, req.file.mimetype)
    console.log(`[voice] Transcribed: "${text.slice(0, 100)}..."`)

    if (!text || text.trim().length === 0) {
      return res.json([])
    }

    // 2. Extract tasks
    const tasks = await provider.smartImport(text, ai_context)
    res.json(tasks)
  } catch (err: any) {
    console.error('[voice error]', err.message)
    res.status(500).json({ error: 'Failed to process voice to tasks', details: err.message })
  }
})

// ── COACHING NOTE ─────────────────────────────────────────────────────────────
app.post('/api/coach', async (req, res) => {
  const { snrPct, signalTasks, noiseTasks, noiseSeconds, signalsDone, pastReflections, provider: providerOverride, api_key } = req.body as {
    snrPct: number
    signalTasks: string[]
    noiseTasks: string[]
    noiseSeconds: number
    signalsDone: number
    pastReflections?: string[]
    provider?: string
    api_key?: string
  }

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    const coaching = await provider.coach({
      snrPct,
      signalTasks,
      noiseTasks,
      noiseSeconds,
      signalsDone,
      pastReflections: pastReflections?.filter(Boolean).slice(0, 5)
    })
    res.json({ coaching })
  } catch (err: any) {
    console.error('[coach error]', err.message)
    res.status(500).json({ error: 'Could not generate coaching note.' })
  }
})

// ── SUBSCRIPTION STATUS (server-side Pro check) ───────────────────────────────
app.get('/api/subscription-status', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.split(' ')[1]

  try {
    // Verify JWT with Supabase
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status, stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const isPro = sub?.status === 'active'
    res.json({ isPro, status: sub?.status ?? 'none' })
  } catch (err: any) {
    console.error('[subscription-status]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── STRIPE PAYMENTS ───────────────────────────────────────────────────────────
app.post('/api/checkout/create-session', async (req, res) => {
  const { userId, email } = req.body as { userId: string; email: string }

  if (!userId) return res.status(400).json({ error: 'userId is required' })

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${APP_URL}/#dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/#settings`,
      customer_email: email,
      client_reference_id: userId,
      metadata: { userId }
    })

    res.json({ url: session.url })
  } catch (err: any) {
    console.error('[stripe error]', err.message)
    res.status(500).json({ error: 'Failed to create checkout session', message: err.message })
  }
})

// ── EXTRACT GOALS FROM DOCUMENT ───────────────────────────────────────────────
// Accepts a .txt or .pdf file, extracts plain text, then uses the AI to
// summarise the user's long-term goals into a concise paragraph that populates
// the ai_context field in Settings.
app.post('/api/extract-goals', upload.single('document'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Missing document file' })

  const { provider: providerOverride, api_key } = req.body as { provider?: string; api_key?: string }
  const mime = req.file.mimetype
  const filename = (req.file as any).originalname?.toLowerCase() ?? ''

  let rawText: string
  try {
    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      const parsed = await pdfParse(req.file.buffer)
      rawText = parsed.text
    } else {
      // Treat as plain text (text/plain, text/markdown, etc.)
      rawText = req.file.buffer.toString('utf-8')
    }
  } catch (err: any) {
    console.error('[extract-goals] parse error:', err.message)
    return res.status(422).json({ error: 'Could not read file. Make sure it is a valid PDF or text file.' })
  }

  if (!rawText || rawText.trim().length < 20) {
    return res.status(422).json({ error: 'Document appears to be empty or too short.' })
  }

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    const goals = await provider.extractGoals(rawText)
    res.json({ goals })
  } catch (err: any) {
    console.error('[extract-goals] AI error:', err.message)
    res.status(500).json({ error: 'Could not extract goals from document.' })
  }
})

// ── WEEK IN REVIEW ────────────────────────────────────────────────────────────
app.post('/api/week-review', requirePro, async (req, res) => {
  const { days, provider: providerOverride, api_key } = req.body as {
    days: WeekReviewInput['days']
    provider?: string
    api_key?: string
  }

  if (!days || !Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: 'Missing days array' })
  }

  try {
    const provider = getProvider(providerOverride, api_key || undefined)
    const synthesis = await provider.weekReview({ days })
    res.json({ synthesis })
  } catch (err: any) {
    console.error('[week-review] error:', err.message)
    res.status(500).json({ error: 'Could not generate Week in Review.' })
  }
})

// ── LEAD CAPTURE ──────────────────────────────────────────────────────────────
// Public endpoint — no auth required. Called from the landing page signup form.
// Saves lead to Supabase and sends a WhatsApp notification via Twilio.

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

if (!twilioClient) {
  console.warn('[leads] Twilio not configured — WhatsApp notifications disabled. Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.')
}

// Simple in-memory rate limiter — max 3 submissions per IP per hour
const leadRateMap = new Map<string, { count: number; resetAt: number }>()

function checkLeadRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = leadRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    leadRateMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
    return true
  }
  if (entry.count >= 3) return false
  entry.count++
  return true
}

app.post('/api/leads', express.json(), async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown'

  if (!checkLeadRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Try again later.' })
  }

  const { name, email } = req.body as { name?: string; email?: string }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required.' })
  }

  const cleanName  = (name ?? '').trim().slice(0, 100)
  const cleanEmail = email.trim().toLowerCase()

  // 1. Upsert into Supabase (on conflict email → update name + updated_at)
  try {
    const { error: dbError } = await supabaseAdmin
      .from('leads')
      .upsert(
        { name: cleanName || null, email: cleanEmail },
        { onConflict: 'email', ignoreDuplicates: false }
      )

    if (dbError) {
      console.error('[leads] Supabase error:', dbError.message)
      // Don't surface DB errors to the client — still try WhatsApp below
    }
  } catch (err: any) {
    console.error('[leads] Supabase exception:', err.message)
  }

  // 2. Send WhatsApp notification to business number
  const NOTIFY_NUMBER = process.env.LEADS_WHATSAPP_NUMBER || '+2348084352639'
  const TWILIO_FROM   = process.env.TWILIO_WHATSAPP_FROM  || 'whatsapp:+14155238886'  // Twilio sandbox default

  if (twilioClient) {
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false })
    const body = [
      '🔔 *New LockIn Lead*',
      `👤 Name:  ${cleanName || '(not provided)'}`,
      `📧 Email: ${cleanEmail}`,
      `🕐 Time:  ${now} (WAT)`,
    ].join('\n')

    try {
      await twilioClient.messages.create({
        from: TWILIO_FROM,
        to:   `whatsapp:${NOTIFY_NUMBER}`,
        body,
      })
    } catch (err: any) {
      // Non-fatal — lead is already saved to DB
      console.warn('[leads] WhatsApp send failed:', err.message)
    }
  }

  res.json({ ok: true, message: 'You\'re on the list! We\'ll notify you at launch.' })
})

// ── Sentry Error Handler (must be after all routes) ───────────────────────────
Sentry.setupExpressErrorHandler(app)


app.listen(PORT, () => {
  const provider = process.env.AI_PROVIDER || 'ollama'
  const model = process.env.OLLAMA_MODEL || 'deepseek-r1:8b'
  console.log(`\n🔌 LockIn AI Proxy running on :${PORT}`)
  console.log(`   Provider : ${provider}`)
  console.log(`   Model    : ${provider === 'ollama' ? model : 'claude-haiku-3-5'}`)
})

export default app
