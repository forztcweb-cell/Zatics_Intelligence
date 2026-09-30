# Zatics Intelligence Website & Lead Management CRM

A high-performance modern website built with TypeScript, Hono, and Vite featuring an automated CRM pipeline connecting **Google Sheets**, **Google Calendar / Google Meet**, and **Resend Email API**.

---

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Environment Variables (.env) Setup Guide](#-environment-variables-env-setup-guide)
  - [1. GOOGLE_SHEET_ID](#1-google_sheet_id)
  - [2. GOOGLE_SHEET_TAB](#2-google_sheet_tab)
  - [3. GOOGLE_SERVICE_ACCOUNT_BASE64](#3-google_service_account_base64)
  - [4. GOOGLE_CALENDAR_ID](#4-google_calendar_id)
  - [5. RESEND_API_KEY](#5-resend_api_key)
  - [6. EMAIL_FROM](#6-email_from)
  - [7. WEBHOOK_SECRET](#7-webhook_secret)
- [Google Sheets & Apps Script Automation Setup](#-google-sheets--apps-script-automation-setup)
- [Local Development & Testing](#-local-development--testing)
- [Deployment (Vercel / Cloudflare)](#-deployment)

---

## ⚡ Quick Start

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Create your `.env` file:**
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env

   # Mac / Linux
   cp .env.example .env
   ```

3. **Fill in all values in `.env`** using the step-by-step instructions below.

4. **Run development server:**
   ```bash
   npm run dev
   ```

---

## 🔑 Environment Variables (.env) Setup Guide

Here is the complete reference of what each variable does and step-by-step instructions on how to find or generate them.

```ini
# .env Configuration File

GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_SHEET_TAB=Enquiries
GOOGLE_SERVICE_ACCOUNT_BASE64=your_base64_encoded_service_account_json_key
GOOGLE_CALENDAR_ID=primary
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
WEBHOOK_SECRET=your_random_webhook_secret_here
```

---

### 1. `GOOGLE_SHEET_ID`
* **Purpose:** The unique ID of the Google Sheet where website contact form submissions are stored.
* **How to find:**
  1. Open [Google Sheets](https://sheets.google.com) and create a new sheet (e.g., `Zatics Enquiries`).
  2. Look at your browser address bar URL:
     ```text
     https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
                                           └───────────────────┬───────────────────┘
                                                       GOOGLE_SHEET_ID
     ```
  3. Copy the string between `/d/` and `/edit`.
  4. Paste into `.env`:
     ```ini
     GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
     ```

---

### 2. `GOOGLE_SHEET_TAB`
* **Purpose:** The exact name of the tab / worksheet inside the Google Sheet where rows are inserted.
* **Default Value:** `Enquiries`
* **How to set:**
  1. Look at the tab name at the bottom of your Google Sheet.
  2. Rename it to `Enquiries` (or keep your sheet tab name and update `.env` accordingly).
     ```ini
     GOOGLE_SHEET_TAB=Enquiries
     ```

---

### 3. `GOOGLE_SERVICE_ACCOUNT_BASE64`
* **Purpose:** Base64-encoded credentials of a Google Cloud Service Account. Used by the backend to securely append rows to Google Sheets and schedule Google Meet links on Google Calendar without requiring interactive user login.
* **How to create & convert:**

#### Step A: Create Service Account in Google Cloud
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `zatics-crm`) or select an existing one.
3. Enable required Google APIs:
   - Go to **APIs & Services** > **Library**.
   - Search for **Google Sheets API** and click **Enable**.
   - Search for **Google Calendar API** and click **Enable**.
4. Create the Service Account:
   - Go to **IAM & Admin** > **Service Accounts**.
   - Click **+ Create Service Account**.
   - Enter a name (e.g. `zatics-backend-bot`), click **Create and Continue**, then click **Done**.
5. Copy the generated Service Account email:
   - Example: `zatics-backend-bot@zatics-crm.iam.gserviceaccount.com`

#### Step B: Share your Google Sheet & Calendar with the Service Account
- **Google Sheet:** Open your Google Sheet > Click **Share** > Paste the Service Account email > Set permission to **Editor** > Click **Send** (uncheck "Notify people").
- **Google Calendar:** Open [Google Calendar](https://calendar.google.com/) > Settings > Under **Settings for my calendars**, select your calendar > Scroll to **Share with specific people or groups** > Click **Add people and groups** > Add the Service Account email > Set permission to **Make changes to events** > Click **Send**.

#### Step C: Generate and Download JSON Key
1. In Google Cloud Console, go back to **Service Accounts**.
2. Click on your Service Account > Navigate to the **Keys** tab.
3. Click **Add Key** > **Create new key** > Select **JSON** > Click **Create**.
4. A file (e.g. `service-account.json`) will be downloaded to your computer.

#### Step D: Encode Key to Base64
Run **one** of the following commands in your terminal in the directory where `service-account.json` is saved:

- **Windows (PowerShell):**
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json')) | Set-Clipboard
  ```
  *(The base64 string is now copied directly to your clipboard!)*

- **macOS:**
  ```bash
  base64 -i service-account.json | pbcopy
  ```

- **Linux:**
  ```bash
  base64 -w 0 service-account.json
  ```

Paste the single long string into `.env`:
```ini
GOOGLE_SERVICE_ACCOUNT_BASE64=ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQi...
```

---

### 4. `GOOGLE_CALENDAR_ID`
* **Purpose:** Target Google Calendar where approved consultations and Google Meet invite links are created.
* **Options:**
  - `primary` — Uses the primary calendar associated with the Google Account that shared the calendar.
  - Custom Calendar ID — Go to **Google Calendar Settings** > Select your specific calendar > Scroll to **Integrate calendar** > Copy the **Calendar ID** (format: `your-email@gmail.com` or `xxxxxxx@group.calendar.google.com`).
* **Example in `.env`:**
  ```ini
  GOOGLE_CALENDAR_ID=primary
  ```

---

### 5. `RESEND_API_KEY`
* **Purpose:** API key for sending confirmation / rejection emails to clients via the Resend email service.
* **How to obtain:**
  1. Sign up or log in at [Resend](https://resend.com).
  2. In the dashboard, navigate to **API Keys**.
  3. Click **Create API Key**.
  4. Set **Name** (e.g. `Zatics Website`) and **Permissions** to `Full access`.
  5. Copy the generated key (starts with `re_...`).
  6. Paste into `.env`:
     ```ini
     RESEND_API_KEY=re_123456789_abcdefghijklmnopqrstuvwxyz
     ```

---

### 6. `EMAIL_FROM`
* **Purpose:** The sender email address shown in the "From" field of notification emails.
* **Configuration:**
  - **Testing / Sandbox (no domain setup yet):**
    ```ini
    EMAIL_FROM=onboarding@resend.dev
    ```
    *(Note: When using `onboarding@resend.dev`, Resend only delivers emails to the verified email address of your Resend account).*
  - **Production (custom domain):**
    1. In Resend Dashboard, go to **Domains** > **Add Domain** (e.g. `zatics.ai`).
    2. Add the provided DKIM, SPF, and MX records to your DNS provider (Cloudflare, GoDaddy, Namecheap, etc.).
    3. Once verified, set:
       ```ini
       EMAIL_FROM=noreply@zatics.ai
       ```

---

### 7. `WEBHOOK_SECRET`
* **Purpose:** A secret token used to authenticate webhook calls made from Google Sheets Apps Script to your backend `/api/webhook/status` endpoint when a lead is marked as `Approve` or `Decline`.
* **How to generate:**
  - Run this in any terminal:
    ```bash
    openssl rand -hex 32
    ```
  - Or generate any secure random string (e.g. `ztc_sec_9f83a82e9b01c44d71e2983`).
  - Set in `.env`:
    ```ini
    WEBHOOK_SECRET=ztc_sec_9f83a82e9b01c44d71e2983
    ```
  > ⚠️ **Important:** The exact same secret must be placed in `google-apps-script.js` (see next section).

---

## 📊 Google Sheets & Apps Script Automation Setup

This repository includes a full automated CRM script in [google-apps-script.js](file:///d:/new_ztc_website-main%20%281%29/new_ztc_website-main/google-apps-script.js).

### Step-by-Step Setup:
1. Open your target Google Sheet.
2. In the top menu, click **Extensions** > **Apps Script**.
3. Clear any existing code in the editor, and paste the entire contents of [google-apps-script.js](file:///d:/new_ztc_website-main%20%281%29/new_ztc_website-main/google-apps-script.js).
4. Update the configuration constants at the top of the script:
   ```javascript
   var WEBHOOK_URL    = 'https://your-domain.com/api/webhook/status'; // Or your ngrok URL for local testing
   var WEBHOOK_SECRET = 'ztc_sec_9f83a82e9b01c44d71e2983';           // MUST MATCH WEBHOOK_SECRET in .env
   ```
5. Click **Save** (💾 icon or Ctrl + S).
6. Select the **`setupAll`** function in the dropdown at the top and click **Run**.
7. Grant Google permissions when prompted.
8. **Done!**
   - The sheet automatically creates clean, simple headers including **`Reminder Status`** in Column L.
   - Dropdown selection arrow is active in the **Status** column (`Pending`, `Approve`, `Decline`).
   - Selecting **Approve** sends the initial confirmation email with the Google Meet link to the client, your personal email (`rahulmishra002003@gmail.com`), and your work email (`contact@zatics.tech`).
   - **Automated 1-Hour Reminders**: The script automatically runs every 10 minutes in the background, checks scheduled consultation dates/times, and sends a **1-Hour Meeting Reminder Email** with the Google Meet link to all recipients 1 hour prior to the meeting!
   - Selecting **Decline** sends a polite decline email to all recipients.

---

## 💻 Local Development & Testing

```bash
# Install dependencies
npm install

# Start local Vite development server
npm run dev
```

### Local Webhook Testing with ngrok:
Because Google Sheets requires a publicly accessible URL to send webhook requests:
1. Start local server: `npm run dev` (running at `http://localhost:3000` or `5173`).
2. Start ngrok tunnel:
   ```bash
   npx ngrok http 3000
   ```
3. Copy the forwarding URL (e.g. `https://abc123xyz.ngrok-free.app`).
4. Update `WEBHOOK_URL` in your Google Apps Script:
   ```javascript
   var WEBHOOK_URL = 'https://abc123xyz.ngrok-free.app/api/webhook/status';
   ```

---

## 🚀 Deployment

### Deploying on Vercel:
1. Push your repository to GitHub.
2. Connect the repository in [Vercel](https://vercel.com).
3. In **Project Settings** > **Environment Variables**, add each of the variables from your `.env`:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SHEET_TAB`
   - `GOOGLE_SERVICE_ACCOUNT_BASE64`
   - `GOOGLE_CALENDAR_ID`
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `WEBHOOK_SECRET`
4. Deploy!

For further deployment troubleshooting, refer to [VERCEL-DEPLOYMENT-GUIDE.md](file:///d:/new_ztc_website-main%20%281%29/new_ztc_website-main/VERCEL-DEPLOYMENT-GUIDE.md).

---

## 🛡️ Security Checklist
- [ ] Never commit `.env` or `service-account.json` to GitHub (verified in `.gitignore`).
- [ ] Ensure `WEBHOOK_SECRET` is sufficiently long and random.
- [ ] Share Google Sheet and Calendar strictly with the Service Account email.
