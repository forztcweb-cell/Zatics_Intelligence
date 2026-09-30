import type { IncomingMessage, ServerResponse } from 'http'
import { createSign } from 'crypto'

export const config = {
  maxDuration: 15
}

function parseServiceAccount(saB64OrJson: string) {
  const trimmed = saB64OrJson.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
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
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`Google Auth failed: ${data.error_description || data.error || res.statusText}`)
  }
  return data.access_token
}

async function appendSheetRow(token: string, sheetId: string, tab: string, values: string[]): Promise<void> {
  const range = encodeURIComponent(`${tab}!A1`)
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [values] })
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google Sheets append failed (${res.status}): ${err}`)
  }
}

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  // Set CORS headers
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

    if (body.website) {
      res.statusCode = 200
      res.end(JSON.stringify({ success: true }))
      return
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim()
    const organisation = String(body.organisation || '').trim()
    const interest = String(body.interest || '').trim()
    const message = String(body.message || '').trim()
    const preferredDate = String(body.preferred_date || '').trim()
    const preferredTime = String(body.preferred_time || '').trim()

    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !organisation || organisation.length > 150 ||
        message.length < 10 || message.length > 3000 || interest.length > 100) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Please check your details and include at least 10 characters about your project.' }))
      return
    }

    const reference = Math.random().toString(36).slice(2, 10).toUpperCase()
    const submittedAt = new Date().toISOString()

    const sheetId = process.env.GOOGLE_SHEET_ID || ''
    const tab = process.env.GOOGLE_SHEET_TAB || 'Enquiries'
    const saB64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 || ''

    if (sheetId && saB64) {
      try {
        const token = await getGoogleToken(saB64, 'https://www.googleapis.com/auth/spreadsheets')
        await appendSheetRow(token, sheetId, tab, [
          reference, name, email, organisation, interest, message,
          preferredDate, preferredTime, submittedAt, 'Pending'
        ])
        console.log(`[Vercel API] Row appended to sheet: ZI-${reference}`)
      } catch (e: any) {
        console.error('[Vercel API] Google Sheets error:', e)
        res.statusCode = 500
        res.end(JSON.stringify({ error: `Could not save to spreadsheet: ${e.message || 'Check server configuration'}` }))
        return
      }
    } else {
      console.warn(`[Vercel API] Google Sheets env vars not fully configured. Reference: ZI-${reference}`)
    }

    res.statusCode = 201
    res.end(JSON.stringify({ success: true, reference }))
  } catch (err: any) {
    console.error('[Vercel API] Handler error:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }))
  }
}
