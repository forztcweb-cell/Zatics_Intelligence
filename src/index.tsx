import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { html, raw } from 'hono/html'

// ── Environment (Cloudflare Worker secrets or vite process.env in dev) ────────
type Bindings = {
  GOOGLE_SHEET_ID?: string
  GOOGLE_SHEET_TAB?: string
  GOOGLE_SERVICE_ACCOUNT_BASE64?: string
  GOOGLE_CALENDAR_ID?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  WEBHOOK_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/static/*', serveStatic({ root: './public' }))
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// ── Google Auth helper (Service Account → JWT → access token) ─────────────────
async function getGoogleAccessToken(serviceAccountBase64: string, scope: string): Promise<string> {
  const json = JSON.parse(atob(serviceAccountBase64))
  const now = Math.floor(Date.now() / 1000)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payload = btoa(JSON.stringify({
    iss: json.client_email, scope, aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  // Import PEM private key
  const pem = json.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '')
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(`${header}.${payload}`))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${header}.${payload}.${sig}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  })
  const data = await res.json() as { access_token: string }
  return data.access_token
}

// ── Append row to Google Sheets ───────────────────────────────────────────────
async function appendToSheet(token: string, sheetId: string, tab: string, values: string[]): Promise<void> {
  const range = encodeURIComponent(`${tab}!A1`)
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] })
  })
}

// ── Create Google Calendar event with Meet link ───────────────────────────────
async function createMeetEvent(token: string, calendarId: string, enquiry: {
  name: string; email: string; organisation: string; interest: string;
  preferredDate: string; preferredTime: string; rowId: string;
}): Promise<string> {
  // Parse date and time — fallback to tomorrow 10am if not set
  let start: string, end: string
  if (enquiry.preferredDate && enquiry.preferredTime) {
    const dt = new Date(`${enquiry.preferredDate}T${enquiry.preferredTime}:00`)
    const dtEnd = new Date(dt.getTime() + 60 * 60 * 1000) // 1-hour meeting
    start = dt.toISOString()
    end = dtEnd.toISOString()
  } else if (enquiry.preferredDate) {
    start = `${enquiry.preferredDate}T10:00:00`
    end = `${enquiry.preferredDate}T11:00:00`
  } else {
    const tomorrow = new Date(Date.now() + 86400000)
    const ds = tomorrow.toISOString().split('T')[0]
    start = `${ds}T10:00:00`
    end = `${ds}T11:00:00`
  }
  const event = {
    summary: `Zatics Consultation — ${enquiry.name} (${enquiry.organisation})`,
    description: `Enquiry reference: ZI-${enquiry.rowId}\nArea of interest: ${enquiry.interest}`,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    attendees: [{ email: enquiry.email }],
    conferenceData: { createRequest: { requestId: enquiry.rowId, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
  )
  const data = await res.json() as { hangoutLink?: string; htmlLink?: string }
  return data.hangoutLink || data.htmlLink || 'https://meet.google.com'
}

// ── Send email via Resend ─────────────────────────────────────────────────────
async function sendEmail(apiKey: string, from: string, to: string | string[], subject: string, html: string): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to]
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: recipients, subject, html })
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('[Resend Error]', res.status, errText)
    throw new Error(`Resend email failed (${res.status}): ${errText}`)
  }
}

// ── POST /api/enquiries — Save to Google Sheets ───────────────────────────────
app.post('/api/enquiries', async (c) => {
  const origin = c.req.header('origin')
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Please submit from this website.' }, 403)
  if (Number(c.req.header('content-length') || 0) > 10000) return c.json({ error: 'Please shorten your message.' }, 413)
  try {
    const data = await c.req.json()
    if (data.website) return c.json({ success: true })
    const name = String(data.name || '').trim()
    const email = String(data.email || '').trim()
    const organisation = String(data.organisation || '').trim()
    const interest = String(data.interest || '').trim()
    const message = String(data.message || '').trim()
    const preferredDate = String(data.preferred_date || '').trim()
    const preferredTime = String(data.preferred_time || '').trim()
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !organisation || organisation.length > 150 || message.length < 10 || message.length > 3000 || interest.length > 100)
      return c.json({ error: 'Please check your details and include at least 10 characters about your project.' }, 400)

    const sheetId = c.env?.GOOGLE_SHEET_ID || (typeof process !== 'undefined' ? process.env.GOOGLE_SHEET_ID : '') || ''
    const tab = c.env?.GOOGLE_SHEET_TAB || (typeof process !== 'undefined' ? process.env.GOOGLE_SHEET_TAB : '') || 'Enquiries'
    const saB64 = c.env?.GOOGLE_SERVICE_ACCOUNT_BASE64 || (typeof process !== 'undefined' ? process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 : '') || ''

    const reference = crypto.randomUUID().slice(0, 8).toUpperCase()
    const submittedAt = new Date().toISOString()

    if (sheetId && saB64) {
      const token = await getGoogleAccessToken(saB64, 'https://www.googleapis.com/auth/spreadsheets')
      // Columns: ID | Name | Email | Organisation | Interest | Message | Preferred Date | Preferred Time | Submitted At | Status
      await appendToSheet(token, sheetId, tab, [
        reference, name, email, organisation, interest, message,
        preferredDate, preferredTime, submittedAt, 'Pending'
      ])
    } else {
      console.warn('[Zatics] Google Sheets not configured — enquiry not persisted.')
    }

    return c.json({ success: true, reference }, 201)
  } catch (error) {
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid request.' }, 400)
    console.error('Enquiry storage error:', error)
    return c.json({ error: 'We could not save your enquiry. Please try again shortly.' }, 503)
  }
})

// ── POST /api/webhook/status — Called by Google Apps Script on status change ──
// Body: { secret, reference, name, email, organisation, interest, message,
//         preferred_date, preferred_time, submitted_at, status: 'Approve'|'Decline' }
app.post('/api/webhook/status', async (c) => {
  try {
    const body = await c.req.json() as Record<string, string>
    const expectedSecret = c.env?.WEBHOOK_SECRET || (typeof process !== 'undefined' ? process.env.WEBHOOK_SECRET : '') || ''
    if (!expectedSecret || body.secret !== expectedSecret) return c.json({ error: 'Unauthorized' }, 401)

    const { reference, name, email, organisation, interest, message, preferred_date, preferred_time, status } = body
    if (!email || !name || !status) return c.json({ error: 'Missing required fields.' }, 400)

    const resendKey = c.env?.RESEND_API_KEY || (typeof process !== 'undefined' ? process.env.RESEND_API_KEY : '') || ''
    const fromEmail = c.env?.EMAIL_FROM || (typeof process !== 'undefined' ? process.env.EMAIL_FROM : '') || 'noreply@zatics.ai'
    const saB64 = c.env?.GOOGLE_SERVICE_ACCOUNT_BASE64 || (typeof process !== 'undefined' ? process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 : '') || ''
    const calendarId = c.env?.GOOGLE_CALENDAR_ID || (typeof process !== 'undefined' ? process.env.GOOGLE_CALENDAR_ID : '') || 'primary'

    if (status === 'Approve') {
      // Create a Google Meet event
      let meetLink = 'https://meet.google.com'
      if (saB64) {
        const calToken = await getGoogleAccessToken(saB64, 'https://www.googleapis.com/auth/calendar')
        meetLink = await createMeetEvent(calToken, calendarId, { name, email, organisation, interest, preferredDate: preferred_date || '', preferredTime: preferred_time || '', rowId: reference || crypto.randomUUID().slice(0, 8) })
      }
      const scheduleNote = (preferred_date || preferred_time)
        ? `<p style="margin:0 0 8px">📅 <strong>Scheduled for:</strong> ${preferred_date || 'TBD'}${preferred_time ? ' at ' + preferred_time : ''}</p>`
        : '<p style="margin:0 0 8px">📅 <strong>Schedule:</strong> We will confirm the exact time shortly.</p>'
      await sendEmail(resendKey, fromEmail, email, `Your AI consultation is confirmed — Zatics Intelligence`, `
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consultation Confirmed</title></head>
<body style="margin:0;padding:0;background:#090b0a;font-family:'DM Sans',sans-serif;color:#eeefea">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px">
<table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden">
  <tr><td style="background:#10170d;padding:32px 40px 0;text-align:center">
    <p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p>
    <h1 style="margin:0;font-size:32px;font-weight:500;letter-spacing:-1.5px;color:#eeefea">Your consultation<br/><span style="color:#d1f89a">is confirmed.</span></h1>
  </td></tr>
  <tr><td style="padding:28px 40px">
    <p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">${name}</strong>,<br/><br/>
    We're excited to connect with you about building AI for <strong style="color:#eeefea">${organisation}</strong>.<br/>
    Below are the details of your consultation.</p>
    <div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">ENQUIRY DETAILS</p>
      <p style="margin:0 0 8px"><strong>Reference:</strong> ZI-${reference}</p>
      <p style="margin:0 0 8px"><strong>Name:</strong> ${name}</p>
      <p style="margin:0 0 8px"><strong>Organisation:</strong> ${organisation}</p>
      <p style="margin:0 0 8px"><strong>Area of Interest:</strong> ${interest}</p>
      <p style="margin:0 0 8px"><strong>Your message:</strong><br/><span style="color:#93a381">${message.replace(/\n/g, '<br/>')}</span></p>
      ${scheduleNote}
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${meetLink}" style="display:inline-block;background:#d1f89a;color:#172011;font-size:14px;font-weight:600;padding:16px 32px;border-radius:6px;text-decoration:none;letter-spacing:-0.3px">
        🎥 Join Google Meet
      </a>
      <p style="margin:12px 0 0;font-size:11px;color:#5e6e51;font-family:monospace">${meetLink}</p>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#5e6e51;line-height:1.7;text-align:center">
      If you have any questions before the call, reply to this email.<br/>
      Looking forward to talking — <strong style="color:#93a381">Zatics Intelligence</strong>
    </p>
  </td></tr>
  <tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14">
    <p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ${new Date().getFullYear()} ZATICS INTELLIGENCE · PURPOSE-BUILT. PRODUCTION-READY.</p>
  </td></tr>
</table></td></tr></table></body></html>`)

    } else if (status === 'Decline') {
      await sendEmail(resendKey, fromEmail, email, `Regarding your enquiry — Zatics Intelligence`, `
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Enquiry Update</title></head>
<body style="margin:0;padding:0;background:#090b0a;font-family:'DM Sans',sans-serif;color:#eeefea">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px">
<table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden">
  <tr><td style="padding:32px 40px 0;text-align:center">
    <p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p>
    <h1 style="margin:0;font-size:32px;font-weight:500;letter-spacing:-1.5px;color:#eeefea">Thank you for<br/><span style="color:#93a381">reaching out.</span></h1>
  </td></tr>
  <tr><td style="padding:28px 40px">
    <p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">${name}</strong>,<br/><br/>
    Thank you for taking the time to share your challenge with us — we genuinely appreciate your interest in Zatics Intelligence.<br/><br/>
    After reviewing your enquiry carefully, we don't believe we're the right fit for your current needs at this stage. We want to be honest with you rather than commit to something that wouldn't deliver real value.<br/><br/>
    This may change as your requirements evolve, and we'd always welcome the opportunity to revisit the conversation in the future.</p>
    <div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">YOUR REFERENCE</p>
      <p style="margin:0;font-family:monospace;font-size:13px;color:#d1f89a">ZI-${reference}</p>
    </div>
    <p style="margin:0;font-size:12px;color:#5e6e51;line-height:1.7;text-align:center">
      We wish you and <strong style="color:#93a381">${organisation}</strong> every success.<br/>
      — <strong style="color:#93a381">The Zatics Intelligence team</strong>
    </p>
  </td></tr>
  <tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14">
    <p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ${new Date().getFullYear()} ZATICS INTELLIGENCE · PURPOSE-BUILT. PRODUCTION-READY.</p>
  </td></tr>
</table></td></tr></table></body></html>`)
    } else {
      return c.json({ error: 'Invalid status. Use "Approve" or "Decline".' }, 400)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return c.json({ error: 'Webhook processing failed.' }, 500)
  }
})


const arrow = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`
const diagonal = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>`
const mark = html`<img class="brand-mark" src="/static/logo.png" alt="" aria-hidden="true"/>`
const icon = (kind: string) => {
  const paths: Record<string, string> = {
    agent: '<path d="m12 3 8 5v8l-8 5-8-5V8l8-5Z"/><path d="m4 8 8 5 8-5M12 13v8M8 5.5l8 5"/>',
    network: '<rect x="9" y="9" width="6" height="6" rx="1"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="m6 6 3 3m6 0 3-3M6 18l3-3m6 0 3 3"/>',
    workflow: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 6h4v4M6 14v4h4M10 6h4M6 10v4"/>',
    brain: '<path d="M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 6V4Zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 6V4ZM5 10h4m6 4h5M5 16h4m6-8h4"/>',
    voice: '<path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4"/>',
    infrastructure: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
  }
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(paths[kind] || paths.agent)}</svg>`
}

app.get('/', (c) => c.html(html`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="theme-color" content="#090b0a"/>
<title>Zatics Intelligence — Intelligence. Engineered to act.</title><meta name="description" content="Zatics Intelligence engineers autonomous AI systems for organisations. AI agents, multi-agent systems, enterprise automation, voice AI, and production-grade infrastructure."/>
<meta property="og:title" content="Zatics Intelligence — Intelligence. Engineered to act."/><meta property="og:description" content="Autonomous AI systems. Purpose-built for your organisation. Engineered for the real world."/><meta property="og:type" content="website"/>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml"/><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=IBM+Plex+Mono:wght@400;450;500&display=swap" rel="stylesheet"/><link rel="stylesheet" href="/static/style.css"/>
</head><body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header" id="site-header"><div class="container header-inner"><a class="brand" href="#" aria-label="Zatics Intelligence home">${mark}<span>ZATICS<span class="brand-subtitle">INTELLIGENCE</span></span></a>
<nav class="desktop-nav" aria-label="Main navigation"><a href="#what-we-build">What we build</a><a href="#how-it-works">How it works</a><a href="#technology">Technology</a><a href="#approach">Our approach</a></nav>
<button class="button button-small button-outline header-cta" data-contact>Let’s talk ${diagonal}</button><button class="menu-toggle" id="menu-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-nav"><span></span><span></span></button></div>
<nav id="mobile-nav" class="mobile-nav" aria-label="Mobile navigation" hidden><a href="#what-we-build">What we build</a><a href="#how-it-works">How it works</a><a href="#technology">Technology</a><a href="#capabilities">Capabilities</a><a href="#approach">Our approach</a><button class="button button-primary" data-contact>Let’s build something ${diagonal}</button></nav></header>
<main id="main">
<section class="hero" id="hero-section"><div class="hero-grid" aria-hidden="true"></div><div class="container hero-inner"><div class="hero-copy"><p class="eyebrow hero-eyebrow"><span class="status-dot"></span> THE NEXT ERA OF ENTERPRISE INTELLIGENCE</p><h1>Intelligence.<br/>Engineered<br/>to <span class="accent">act.</span></h1><p class="hero-description">We build autonomous AI systems that think,<br class="desktop-break"/> decide, and execute. <span>Not just respond.</span></p><div class="hero-actions"><button class="button button-primary" data-contact>Build your AI system ${diagonal}</button><a class="text-link" href="#what-we-build">Explore what we build <span>↓</span></a></div><p class="hero-footnote"><span class="tiny-cross">+</span> PURPOSE-BUILT. PRODUCTION-READY.</p></div>
<div class="intelligence-visual" id="intelligence-visual"><div class="core-ambient"></div><canvas id="intelligence-canvas" aria-label="Animated three-dimensional intelligence core, with connected reasoning and execution nodes" role="img"></canvas><div class="orb-cross cross-one">+</div><div class="orb-cross cross-two">+</div><div class="orb-cross cross-three">+</div><div class="visual-coordinate coordinate-top">ZI / AUTONOMOUS CORE</div><div class="core-tag tag-reason"><span class="status-dot"></span> REASONING ENGINE <span class="tag-indicator">01</span></div><div class="core-tag tag-agent">${icon('network')} AGENT ORCHESTRATION <span class="tag-indicator">02</span></div><div class="core-tag tag-execution"><span class="execution-check">✓</span> EXECUTION LAYER <span class="tag-indicator">03</span></div><div class="core-caption"><span class="status-dot"></span><span>INTELLIGENCE IN MOTION</span><span class="core-wave">▁▃▆▃▁▃▅▂</span></div><button class="motion-toggle" id="motion-toggle" aria-label="Pause visual animation" aria-pressed="false">Ⅱ</button></div>
</div><div class="container hero-bottom"><span>A SYSTEMS COMPANY.<br/><strong>NOT ANOTHER AI AGENCY.</strong></span><p>Beyond prompts. Beyond chatbots.<br/>Intelligence that moves your organisation forward.</p><a href="#what-we-build" class="scroll-cue" aria-label="Scroll to what we build">↓</a></div></section>
<section class="expertise-strip" aria-label="Our areas of expertise"><div class="container expertise-list"><span>${icon('agent')} Autonomous agents</span><span>${icon('network')} Multi-agent systems</span><span>${icon('workflow')} AI automation</span><span>${icon('brain')} Enterprise intelligence</span><span>${icon('voice')} Voice AI</span><span>${icon('infrastructure')} AI infrastructure</span></div></section>
<section class="section build-section" id="what-we-build"><div class="container"><div class="section-heading reveal"><div><p class="eyebrow"><span class="section-number">01 /</span> WHAT WE BUILD</p><h2>Not just artificial intelligence.<br/><span class="muted">Operational intelligence.</span></h2></div><p class="section-intro">Systems that don’t stop at an answer.<br/>They take the next step. And the one after that.</p></div>
<div class="build-grid">
<article class="build-card reveal" tabindex="0"><div class="card-top"><span class="card-index">SYSTEM / 01</span>${icon('agent')}</div><div class="card-visual agent-visual" aria-hidden="true"><div class="agent-orbit orbit-a"></div><div class="agent-orbit orbit-b"></div><div class="agent-node">${mark}</div><span class="orbit-point point-a"></span><span class="orbit-point point-b"></span><span class="orbit-label">PERCEIVE → REASON → ACT</span></div><h3>Autonomous AI agents</h3><p>Purpose-built agents that understand context, reason through complexity, and execute tasks with defined autonomy.</p><a class="card-link" href="#capabilities" data-capability="0">Intelligence with initiative ${diagonal}</a></article>
<article class="build-card reveal" tabindex="0"><div class="card-top"><span class="card-index">SYSTEM / 02</span>${icon('network')}</div><div class="card-visual network-visual" aria-hidden="true"><svg viewBox="0 0 330 180"><path class="network-lines" d="M165 90 70 38M165 90 263 38M165 90 66 144M165 90 264 144M70 38H263M66 144H264"/><circle class="network-halo" cx="165" cy="90" r="39"/><rect class="network-center" x="142" y="67" width="46" height="46" rx="9"/><path class="network-glyph" d="M155 82h20m-20 8h20m-20 8h13"/>${[ [70,38], [263,38], [66,144], [264,144] ].map(([x,y]) => html`<rect class="network-small" x="${x-17}" y="${y-17}" width="34" height="34" rx="7"/><circle class="network-dot" cx="${x}" cy="${y}" r="4"/>`)}</svg><span class="network-label label-one">RESEARCH</span><span class="network-label label-two">EXECUTE</span></div><h3>Multi-agent systems</h3><p>Specialised agents working as one. Coordinated intelligence that solves problems no single model can handle alone.</p><a class="card-link" href="#capabilities" data-capability="1">A team. Not a single tool. ${diagonal}</a></article>
<article class="build-card reveal" tabindex="0"><div class="card-top"><span class="card-index">SYSTEM / 03</span>${icon('workflow')}</div><div class="card-visual workflow-visual" aria-hidden="true"><div class="mini-flow"><span>${icon('infrastructure')}</span><i></i><span class="flow-active">${icon('brain')}</span><i></i><span>${icon('workflow')}</span></div><div class="mini-log"><span>workflow.execute()</span><span>✓ completed</span></div><div class="mini-log muted-log"><span>human_intervention</span><span>on exception</span></div></div><h3>Intelligent automation</h3><p>Connect knowledge, decisions, and action. Turn fragmented processes into intelligent, end-to-end workflows.</p><a class="card-link" href="#capabilities" data-capability="2">From input to outcome ${diagonal}</a></article>
</div><p class="build-note reveal">Built around your operations. <span>Not the other way around.</span></p></div></section>
<section class="section system-section" id="how-it-works"><div class="container"><div class="section-heading reveal"><div><p class="eyebrow"><span class="section-number">02 /</span> HOW IT WORKS</p><h2>From information.<br/><span class="muted">To autonomous action.</span></h2></div><p class="section-intro">One connected intelligence layer.<br/>Every decision grounded. Every action traceable.</p></div>
<div class="system-console reveal"><div class="console-topbar"><span><span class="status-dot"></span> ZATICS / SYSTEM ARCHITECTURE</span><span class="demo-label">INTERACTIVE DEMO</span></div><div class="console-toolbar"><label for="workflow-select">WORKFLOW<select id="workflow-select"><option value="invoice">Invoice processing</option><option value="customer">Customer operations</option><option value="knowledge">Knowledge discovery</option></select></label><button class="button button-small button-primary" id="run-workflow"><span class="play-icon">▷</span> Run simulation</button></div>
<div class="pipeline" role="group" aria-label="Explore the system stages">${[['01','Understand','infrastructure','Ingest & contextualise'],['02','Reason','brain','Analyse & plan'],['03','Decide','agent','Evaluate & validate'],['04','Coordinate','network','Delegate & orchestrate'],['05','Execute','workflow','Act & verify']].map(([n,title,i,sub],idx) => html`<button class="pipeline-step ${idx===0?'selected':''}" data-step="${idx}" aria-pressed="${idx===0?'true':'false'}"><span class="step-meta">${n}<span class="step-status">READY</span></span><span class="pipeline-icon">${icon(i)}</span><strong>${title}</strong><span class="step-description">${sub}</span></button>`)}</div>
<div class="console-detail"><div><span class="detail-eyebrow" id="stage-label">01 / UNDERSTAND</span><h3 id="stage-title">Context before computation.</h3><p id="stage-description">Connect documents, business systems, and live data. Transform fragmented information into grounded, usable context.</p></div><div class="terminal" aria-live="polite" aria-atomic="true"><p><span class="terminal-prompt">›</span> <span id="terminal-line">system.ready — awaiting workflow</span></p><p class="terminal-secondary" id="terminal-secondary">Select a workflow and run the simulation.<span class="cursor"></span></p></div></div><div class="console-footer"><span>${icon('shield')} HUMAN OVERSIGHT AT EVERY CRITICAL POINT</span><span>ILLUSTRATIVE WORKFLOW · NO LIVE DATA</span></div></div>
</div></section>
<section class="section technology-section" id="technology"><div class="container technology-layout"><div class="technology-copy reveal"><p class="eyebrow"><span class="section-number">03 /</span> THE TECHNOLOGY</p><h2>Built on intelligence.<br/><span class="muted">Grounded in engineering.</span></h2><p class="body-copy">The model is only the beginning. We engineer the entire system around it — the context, orchestration, integrations, and controls that make AI work in the real world.</p><div class="tech-tabs" role="tablist" aria-label="Technology principles"><button role="tab" id="tech-tab-0" aria-selected="true" aria-controls="tech-panel" data-tech="0">${icon('code')} Model-agnostic<span>+</span></button><button role="tab" id="tech-tab-1" aria-selected="false" aria-controls="tech-panel" tabindex="-1" data-tech="1">${icon('shield')} Secure by architecture<span>+</span></button><button role="tab" id="tech-tab-2" aria-selected="false" aria-controls="tech-panel" tabindex="-1" data-tech="2">${icon('eye')} Observable by design<span>+</span></button></div></div>
<div class="tech-panel reveal" id="tech-panel" role="tabpanel" aria-labelledby="tech-tab-0"><div class="tech-panel-top"><span>THE ZATICS INTELLIGENCE STACK</span><span class="status-dot"></span></div><div class="stack-diagram"><div class="stack-layer layer-app"><span>APPLICATION LAYER</span><strong>Your business. Your workflows.</strong><span class="stack-symbol">↗</span></div><div class="stack-connector"></div><div class="stack-layer layer-intelligence">${mark}<div><span>INTELLIGENCE LAYER</span><strong>Zatics orchestration engine</strong></div><span class="layer-pulse"></span></div><div class="stack-connector"></div><div class="stack-models"><span>Foundation models</span><span>Enterprise data</span><span>Tools & APIs</span></div><div class="stack-base"><span>SECURITY</span><i></i><span>MEMORY</span><i></i><span>OBSERVABILITY</span></div></div><div class="tech-panel-caption"><p id="tech-title">The right model. Not just one model.</p><span id="tech-description">We select and route between models based on task complexity, latency, cost, and your data requirements. No unnecessary lock-in.</span></div></div></div></section>
<section class="section capabilities-section" id="capabilities"><div class="container"><div class="section-heading reveal"><div><p class="eyebrow"><span class="section-number">04 /</span> OUR CAPABILITIES</p><h2>One intelligence partner.<br/><span class="muted">An entire spectrum of possibility.</span></h2></div><button class="text-link" data-contact>Find your starting point ${diagonal}</button></div><div class="capability-grid">${[
['agent','Autonomous AI Agents','Agents that work with intent.','Goal-driven reasoning, tool use, persistent memory, and controlled execution. Designed for defined roles within your organisation.','Research agents · Operational agents · Decision support'],
['network','Multi-Agent Systems','Specialised intelligence. Shared objectives.','Architectures that distribute complex work across specialised agents, with clear handoffs, shared context, and coordinated execution.','Agent orchestration · Task delegation · Shared memory'],
['workflow','AI Automation','Complex processes. Seamless execution.','Intelligent workflows that adapt to unstructured inputs, connect existing systems, and escalate exceptions to the right people.','Document processing · Business workflows · API integrations'],
['brain','Enterprise Intelligence','Your knowledge, put to work.','Connect siloed organisational knowledge to give teams contextual answers, actionable insights, and grounded decision support.','Enterprise search · Retrieval systems · Knowledge graphs'],
['voice','Voice AI','Conversations that move things forward.','Natural voice interfaces connected to business workflows. Designed to understand intent, complete tasks, and hand off with context.','Voice agents · Conversational workflows · Human handoff'],
['infrastructure','AI Infrastructure','The foundation for production AI.','Reliable deployment, evaluation, monitoring, and governance. The engineering beneath intelligence you can confidently operate.','LLM operations · Evaluation pipelines · Secure deployment']
].map(([i,title,sub,desc,tags],idx) => html`<article class="capability-card reveal"><details id="capability-${idx}"><summary><span class="capability-icon">${icon(i)}</span><span class="capability-index">0${idx+1}</span><h3>${title}</h3><p>${sub}</p><span class="expand-indicator" aria-hidden="true">+</span></summary><div class="capability-details"><p>${desc}</p><span>${tags}</span><button class="text-link" data-contact data-interest="${title}">Discuss this capability ${diagonal}</button></div></details></article>`)}</div></div></section>
<section class="section outcomes-section" id="outcomes"><div class="container"><div class="outcomes-heading reveal"><p class="eyebrow"><span class="section-number">05 /</span> THE OUTCOMES</p><h2>Less friction.<br/>More <span class="accent">forward.</span></h2><p>Technology is the means.<br/>Organisational progress is the measure.</p></div><div class="outcomes-grid"><article class="outcome-card reveal"><span class="outcome-graphic graphic-speed" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="outcome-from">FROM MANUAL BOTTLENECKS</span><h3>To operational flow.</h3><p>Reduce repetitive work and give your people more time for the decisions that matter.</p><span class="outcome-measure">MEASURE: TIME RETURNED</span></article><article class="outcome-card reveal"><span class="outcome-graphic graphic-connected" aria-hidden="true"><i></i><i></i><i></i></span><span class="outcome-from">FROM FRAGMENTED INFORMATION</span><h3>To connected insight.</h3><p>Bring knowledge into the moment it’s needed, so every action starts with better context.</p><span class="outcome-measure">MEASURE: DECISION QUALITY</span></article><article class="outcome-card reveal"><span class="outcome-graphic graphic-scale" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="outcome-from">FROM CAPACITY CONSTRAINTS</span><h3>To scalable execution.</h3><p>Expand what your organisation can accomplish without multiplying operational overhead.</p><span class="outcome-measure">MEASURE: OPERATIONAL CAPACITY</span></article></div></div></section>
<section class="section approach-section" id="approach"><div class="container approach-layout"><div class="approach-copy reveal"><p class="eyebrow"><span class="section-number">06 /</span> OUR APPROACH</p><h2>No AI for AI’s sake.<br/><span class="muted">An engineering<br/>partnership.</span></h2><p class="body-copy">We start with your reality, not a demo.<br/>Then build, validate, and evolve the right system for it.</p><button class="text-link" data-contact>Talk to us about your challenge ${diagonal}</button><div class="approach-note">${icon('agent')}<span>From first principles.<br/><strong>To production systems.</strong></span></div></div><div class="approach-steps reveal">${[
['Discover','Understand the operation.','We map your workflows, data, constraints, and decision points. Together, we identify where autonomous intelligence can create meaningful value.','Workflow mapping / Feasibility / Success criteria'],
['Architect','Design the right system.','We define the agent architecture, model strategy, integrations, security boundaries, and human oversight. Every component has a reason to exist.','System design / Governance / Integration strategy'],
['Engineer','Build. Test. Challenge.','We develop in focused iterations and test against real scenarios. Reliability, safety, and measurable performance are engineered in — not added later.','Development / Evaluation / Adversarial testing'],
['Evolve','Operate with confidence.','We deploy with visibility and control, monitor outcomes, and continuously improve the system as your organisation’s needs evolve.','Deployment / Monitoring / Continuous improvement']
].map(([title,sub,desc,tags],idx) => html`<details class="approach-step" name="approach" ${idx===0?html`open`:''}><summary><span class="approach-index">0${idx+1}</span><div><h3>${title}</h3><p>${sub}</p></div><span class="approach-plus">+</span></summary><div class="approach-detail"><p>${desc}</p><span>${tags}</span></div></details>`)}</div></div></section>
<section class="cta-section" id="contact"><div class="cta-grid" aria-hidden="true"></div><div class="container cta-inner reveal"><p class="eyebrow"><span class="status-dot"></span> YOUR NEXT CHAPTER STARTS HERE</p><h2>Don’t just adopt AI.<br/><span class="muted">Build an intelligent</span><br/>organisation.</h2><p>Let’s engineer what comes next.</p><button class="button button-primary" data-contact>Start a conversation ${diagonal}</button><span class="cta-footnote">YOUR CHALLENGE. OUR ENGINEERING. REAL POSSIBILITIES.</span></div></section>
</main><footer class="site-footer"><div class="container"><div class="footer-top"><a class="brand" href="#" aria-label="Zatics Intelligence home">${mark}<span>ZATICS<span class="brand-subtitle">INTELLIGENCE</span></span></a><p>Autonomous systems.<br/>Real-world intelligence.</p><nav aria-label="Footer navigation"><a href="#what-we-build">What we build</a><a href="#technology">Technology</a><a href="#approach">Our approach</a><button data-contact>Get in touch ${diagonal}</button></nav></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Zatics Intelligence. All rights reserved.</span><span class="footer-signature"><span class="status-dot"></span> ENGINEERED FOR WHAT’S NEXT.</span><button class="back-to-top" id="back-to-top">Back to top ↑</button></div></div></footer>
<dialog id="contact-dialog" class="contact-dialog" aria-labelledby="contact-title"><button class="dialog-close" id="dialog-close" aria-label="Close enquiry form">×</button><div id="contact-form-view"><p class="eyebrow"><span class="status-dot"></span> LET’S BUILD WHAT’S NEXT</p><h2 id="contact-title">What could intelligence<br/><span class="muted">do for your organisation?</span></h2><p class="dialog-intro">Tell us about your challenge. Let’s find the right starting point.</p><form id="contact-form"><div class="form-row"><label>Your name<input name="name" autocomplete="name" maxlength="100" placeholder="Alex Morgan" required/></label><label>Work email<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="alex@company.com" required/></label></div><label>Organisation<input name="organisation" autocomplete="organization" maxlength="150" placeholder="Your organisation" required/></label><label>Area of interest<select name="interest" id="contact-interest"><option>Let’s explore together</option><option>Autonomous AI Agents</option><option>Multi-Agent Systems</option><option>AI Automation</option><option>Enterprise Intelligence</option><option>Voice AI</option><option>AI Infrastructure</option></select></label><div class="schedule-section"><div class="schedule-section-header"><span class="schedule-section-label"><span class="status-dot"></span> Preferred Consultation Schedule</span><span class="schedule-section-badge">Optional</span></div><div class="form-row"><label>Preferred date<input type="date" name="preferred_date" id="contact-date" aria-label="Preferred consultation date"/></label><label>Preferred time<input type="time" name="preferred_time" id="contact-time" step="900" aria-label="Preferred consultation time"/></label></div><div class="schedule-slots" role="group" aria-label="Quick time slots"><span class="schedule-slots-title">Quick slots:</span><button type="button" class="slot-pill" data-time="10:00">10:00 AM</button><button type="button" class="slot-pill" data-time="14:00">02:00 PM</button><button type="button" class="slot-pill" data-time="16:30">04:30 PM</button><button type="button" class="slot-pill" data-time="18:00">06:00 PM</button></div></div><label>What would you like to make possible?<textarea name="message" rows="3" minlength="10" maxlength="3000" placeholder="A workflow to rethink. A challenge to solve. An idea to explore." required></textarea></label><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"/></label><p class="form-privacy">Your details are stored securely to handle your enquiry. Please don’t include confidential or sensitive business information.</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="button button-primary form-submit">Send your enquiry ${diagonal}</button></form></div><div id="contact-success" class="contact-success" hidden><div class="success-symbol">✓</div><p class="eyebrow">ENQUIRY RECEIVED</p><h2>A meaningful<br/><span class="accent">first step.</span></h2><p>Your project brief has been saved. Thank you for sharing what you’re looking to build with Zatics Intelligence.</p><div id="enquiry-schedule-summary" class="schedule-confirmation" hidden></div><span id="enquiry-reference" class="enquiry-reference"></span><button class="button button-outline" id="success-close">Back to exploring ${arrow}</button></div></dialog>
<script src="/static/app.js" defer></script></body></html>`))
export default app
