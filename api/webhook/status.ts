import type { IncomingMessage, ServerResponse } from 'http'
import { createSign } from 'crypto'

function parseServiceAccount(saB64OrJson: string) {
  const trimmed = saB64OrJson.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  const decoded = Buffer.from(trimmed, 'base64').toString('utf-8')
  return JSON.parse(decoded)
}

async function getGoogleToken(saB64OrJson: string, scope: string): Promise<string> {
  const json = parseServiceAccount(saB64OrJson)
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: json.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url')

  let privateKey = json.private_key
  if (typeof privateKey === 'string') {
    privateKey = privateKey.replace(/\\n/g, '\n')
  }

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const sig = sign.sign(privateKey, 'base64url')
  const jwt = `${header}.${payload}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  })
  const data = await res.json() as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`Google Auth failed: ${data.error || res.statusText}`)
  }
  return data.access_token
}

async function createCalendarMeet(token: string, calendarId: string, e: {
  name: string; email: string; organisation: string; interest: string;
  preferredDate: string; preferredTime: string; rowId: string;
}): Promise<string> {
  let start: string, end: string
  if (e.preferredDate && e.preferredTime) {
    const dt = new Date(`${e.preferredDate}T${e.preferredTime}:00`)
    start = dt.toISOString()
    end = new Date(dt.getTime() + 3600000).toISOString()
  } else if (e.preferredDate) {
    start = `${e.preferredDate}T10:00:00`
    end = `${e.preferredDate}T11:00:00`
  } else {
    const ds = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    start = `${ds}T10:00:00`
    end = `${ds}T11:00:00`
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: `Zatics Consultation — ${e.name} (${e.organisation})`,
        description: `Ref: ZI-${e.rowId}\nInterest: ${e.interest}`,
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
        attendees: [{ email: e.email }],
        conferenceData: { createRequest: { requestId: e.rowId, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      })
    }
  )
  const d = await res.json() as { hangoutLink?: string; htmlLink?: string }
  return d.hangoutLink || d.htmlLink || 'https://meet.google.com'
}

async function sendResendEmail(apiKey: string, from: string, to: string | string[], subject: string, htmlBody: string): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to]
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: recipients, subject, html: htmlBody })
  })
  if (!res.ok) {
    const d = await res.text()
    throw new Error(`Resend failed (${res.status}): ${d}`)
  }
}

function buildApprovalEmail(p: { name: string; organisation: string; interest: string; message: string; reference: string; preferredDate?: string; preferredTime?: string; meetLink: string }): string {
  const yr = new Date().getFullYear()
  const schedNote = (p.preferredDate || p.preferredTime)
    ? `<p style="margin:0 0 8px">📅 <strong>Scheduled for:</strong> ${p.preferredDate || 'TBD'}${p.preferredTime ? ' at ' + p.preferredTime : ''}</p>`
    : `<p style="margin:0 0 8px">📅 <strong>Schedule:</strong> We will confirm the exact time shortly.</p>`
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#090b0a;font-family:sans-serif;color:#eeefea"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px"><table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 40px 0;text-align:center"><p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p><h1 style="margin:0;font-size:32px;font-weight:500;color:#eeefea">Your consultation<br/><span style="color:#d1f89a">is confirmed.</span></h1></td></tr><tr><td style="padding:28px 40px"><p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">${p.name}</strong>,<br/><br/>We're excited to connect with you about building AI for <strong style="color:#eeefea">${p.organisation}</strong>.</p><div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px"><p style="margin:0 0 8px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">ENQUIRY DETAILS</p><p style="margin:0 0 8px"><strong>Reference:</strong> ZI-${p.reference}</p><p style="margin:0 0 8px"><strong>Name:</strong> ${p.name}</p><p style="margin:0 0 8px"><strong>Organisation:</strong> ${p.organisation}</p><p style="margin:0 0 8px"><strong>Area of Interest:</strong> ${p.interest}</p><p style="margin:0 0 8px"><strong>Your message:</strong><br/><span style="color:#93a381">${(p.message||'').replace(/\n/g,'<br/>')}</span></p>${schedNote}</div><div style="text-align:center;margin:28px 0"><a href="${p.meetLink}" style="display:inline-block;background:#d1f89a;color:#172011;font-size:14px;font-weight:600;padding:16px 32px;border-radius:6px;text-decoration:none">🎥 Join Google Meet</a><p style="margin:12px 0 0;font-size:11px;color:#5e6e51;font-family:monospace">${p.meetLink}</p></div></td></tr><tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14"><p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ${yr} ZATICS INTELLIGENCE</p></td></tr></table></td></tr></table></body></html>`
}

function buildDeclineEmail(p: { name: string; organisation: string; reference: string }): string {
  const yr = new Date().getFullYear()
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#090b0a;font-family:sans-serif;color:#eeefea"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px"><table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 40px 0;text-align:center"><p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p><h1 style="margin:0;font-size:32px;font-weight:500;color:#eeefea">Thank you for<br/><span style="color:#93a381">reaching out.</span></h1></td></tr><tr><td style="padding:28px 40px"><p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">${p.name}</strong>,<br/><br/>Thank you for taking the time to share your challenge with us — we genuinely appreciate your interest in Zatics Intelligence.<br/><br/>After reviewing your enquiry carefully, we don't believe we're the right fit for your current needs at this stage. This may change as your requirements evolve, and we'd welcome the opportunity to revisit this conversation in the future.</p><div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px"><p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">YOUR REFERENCE</p><p style="margin:0;font-family:monospace;font-size:13px;color:#d1f89a">ZI-${p.reference}</p></div><p style="margin:0;font-size:12px;color:#5e6e51;line-height:1.7;text-align:center">We wish you and <strong style="color:#93a381">${p.organisation}</strong> every success.<br/>— <strong style="color:#93a381">The Zatics Intelligence team</strong></p></td></tr><tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14"><p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ${yr} ZATICS INTELLIGENCE</p></td></tr></table></td></tr></table></body></html>`
}

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.statusCode = 200
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    let bodyText = ''
    if (typeof req.body === 'object' && req.body !== null) {
      bodyText = JSON.stringify(req.body)
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      }
      bodyText = Buffer.concat(chunks).toString('utf-8')
    }

    const body = bodyText ? JSON.parse(bodyText) : {}
    const expectedSecret = process.env.WEBHOOK_SECRET || ''
    if (!expectedSecret || body.secret !== expectedSecret) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const { reference, name, email, organisation, interest, message, preferred_date, preferred_time, status } = body
    if (!email || !name || !status) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing required fields.' }))
      return
    }

    const resendKey = process.env.RESEND_API_KEY || ''
    const fromEmail = process.env.EMAIL_FROM || 'noreply@zatics.ai'
    const saB64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 || ''
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'

    if (status === 'Approve') {
      let meetLink = 'https://meet.google.com'
      if (saB64) {
        try {
          const calToken = await getGoogleToken(saB64, 'https://www.googleapis.com/auth/calendar')
          meetLink = await createCalendarMeet(calToken, calendarId, {
            name, email, organisation, interest,
            preferredDate: preferred_date || '',
            preferredTime: preferred_time || '',
            rowId: reference || 'ZI'
          })
        } catch (e) {
          console.error('[Vercel Webhook] Calendar error:', e)
        }
      }
      if (resendKey) {
        await sendResendEmail(resendKey, fromEmail, email, 'Your AI consultation is confirmed — Zatics Intelligence', buildApprovalEmail({
          name, organisation, interest, message, reference,
          preferredDate: preferred_date, preferredTime: preferred_time, meetLink
        }))
      }
    } else if (status === 'Decline') {
      if (resendKey) {
        await sendResendEmail(resendKey, fromEmail, email, 'Regarding your enquiry — Zatics Intelligence', buildDeclineEmail({
          name, organisation, reference
        }))
      }
    } else {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid status.' }))
      return
    }

    res.statusCode = 200
    res.end(JSON.stringify({ success: true }))
  } catch (err: any) {
    console.error('[Vercel Webhook] Error:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: err.message || 'Webhook failed.' }))
  }
}
