/**
 * Zatics Intelligence — Google Sheets Automation, Direct Email & 1-Hour Meeting Reminders
 * =========================================================================================
 * Paste this entire script into your Google Sheet's Apps Script editor:
 *   Extensions → Apps Script → paste → Save (Ctrl+S) → Run "setupAll"
 *
 * WHAT THIS SCRIPT DOES:
 *  1. Sends confirmation + Google Meet link on "Approve" directly to user & your team.
 *  2. Sends polite apology email on "Decline" directly to user & your team.
 *  3. Automatically sends a 1-HOUR MEETING REMINDER with the Google Meet link before consultation.
 *  4. Cleans headers and adds dropdown selection on Status.
 *  5. Writes Action Result (Column K) & Reminder Status (Column L).
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Paste your Resend API Key here (from your .env file):
var RESEND_API_KEY = 're_YOUR_RESEND_API_KEY_HERE';  // 👈 Replace with your RESEND_API_KEY
var EMAIL_FROM     = 'noreply@zatics.tech';                   // Verified Sender in Resend

// 👉 PUT YOUR PERSONAL & WORK EMAILS HERE TO RECEIVE COPIES:
var ADMIN_EMAILS   = [
  'rahulmishra002003@gmail.com',  // 👈 Personal email for alerts & reminders
  'contact@zatics.tech'             // 👈 Work email for alerts & reminders
];

var STATUS_COL     = 10;  // Column J = Status (1-indexed)
var RESULT_COL     = 11;  // Column K = Action Result (1-indexed)
var REMINDER_COL   = 12;  // Column L = Reminder Status (1-indexed)
var HEADER_ROW     = 1;   // Row 1 is the header row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Automatically creates a menu in Google Sheets when opened.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ Zatics CRM')
    .addItem('1. Complete Auto-Setup (Headers, Dropdowns & All Triggers)', 'setupAll')
    .addItem('2. Setup Headers & Dropdowns Only', 'setupHeaders')
    .addItem('3. Clean Sheet (Remove All Colors & Custom Fonts)', 'cleanSheetFormatting')
    .addItem('4. Install Edit & Reminder Triggers', 'setupTrigger')
    .addSeparator()
    .addItem('5. Test Approval Email (Send to Personal & Work Mail)', 'testEmailNotification')
    .addItem('6. Test 1-Hour Reminder Email (Send Right Now)', 'testReminderEmail')
    .addItem('7. Run 1-Hour Reminder Check Now', 'checkAndSendReminders')
    .addToUi();
}

/**
 * Full one-click setup.
 */
function setupAll() {
  cleanSheetFormatting();
  setupHeaders();
  setupTrigger();
  SpreadsheetApp.getActiveSpreadsheet().toast('Zatics CRM setup complete with 1-hour reminders enabled!', 'Success', 5);
}

/**
 * Removes all background colors, custom fonts, and conditional formatting.
 */
function cleanSheetFormatting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet() || ss.getSheets()[0];

  sheet.clearConditionalFormatRules();

  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();

  if (maxRows > 1) {
    var dataRange = sheet.getRange(2, 1, maxRows - 1, maxCols);
    dataRange.setBackground(null);
    dataRange.setFontColor('#000000');
    dataRange.setFontFamily('Arial');
    dataRange.setFontSize(10);
    dataRange.setFontWeight('normal');
    dataRange.setFontStyle('normal');
    dataRange.setVerticalAlignment('middle');
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Sheet formatting reset to plain & clean.', 'Done', 3);
}

/**
 * Sets up simple, clean column headers and a dropdown selector on Column J.
 */
function setupHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet() || ss.getSheets()[0];

  var headers = [
    'Reference',
    'Name',
    'Email',
    'Organisation',
    'Interest',
    'Message',
    'Preferred Date',
    'Preferred Time',
    'Submitted At',
    'Status',
    'Action Result',
    'Reminder Status'
  ];

  cleanSheetFormatting();

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#000000');
  headerRange.setBackground(null);
  headerRange.setFontFamily('Arial');
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  sheet.setRowHeight(1, 30);
  sheet.setFrozenRows(1);

  // Status Dropdown
  var statusRange = sheet.getRange(2, STATUS_COL, 999, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'Approve', 'Decline'], true)
    .setAllowInvalid(false)
    .setHelpText('Click the arrow and select Pending, Approve, or Decline.')
    .build();
  statusRange.setDataValidation(rule);
  statusRange.setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 160);
  sheet.setColumnWidth(5, 170);
  sheet.setColumnWidth(6, 260);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 120);
  sheet.setColumnWidth(9, 150);
  sheet.setColumnWidth(10, 130);
  sheet.setColumnWidth(11, 280);
  sheet.setColumnWidth(12, 240);

  Logger.log('Headers and dropdown configured.');
}

/**
 * Installs both:
 * 1. OnEdit trigger for immediate status processing.
 * 2. Time-driven trigger (every 10 minutes) for 1-hour meeting reminders.
 */
function setupTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    var func = triggers[i].getHandlerFunction();
    if (func === 'onEditTrigger' || func === 'checkAndSendReminders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 1. Edit Trigger
  ScriptApp.newTrigger('onEditTrigger')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  // 2. 1-Hour Reminder Timer (Checks every 10 minutes)
  ScriptApp.newTrigger('checkAndSendReminders')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('Status edit trigger and 10-minute reminder triggers installed.');
}

/**
 * Triggered automatically when Status is edited.
 */
function onEditTrigger(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();

  if (range.getColumn() !== STATUS_COL) return;
  if (range.getRow() <= HEADER_ROW) return;

  var status = String(range.getValue()).trim();
  if (status !== 'Approve' && status !== 'Decline') return;

  var row = range.getRow();
  var values = sheet.getRange(row, 1, 1, Math.max(STATUS_COL, sheet.getLastColumn())).getValues()[0];

  var enquiry = {
    reference:      String(values[0] || '').trim(),
    name:           String(values[1] || '').trim(),
    email:          String(values[2] || '').trim(),
    organisation:   String(values[3] || '').trim(),
    interest:       String(values[4] || '').trim(),
    message:        String(values[5] || '').trim(),
    preferred_date: values[6],
    preferred_time: values[7],
    submitted_at:   String(values[8] || '').trim(),
    status:         status
  };

  var resultCell = sheet.getRange(row, RESULT_COL);
  resultCell.setValue('⏳ Sending ' + status + ' email...');

  try {
    var recipients = buildRecipientList(enquiry.email);

    if (recipients.length === 0) {
      resultCell.setValue('⚠ Error: No valid email address found in row ' + row);
      return;
    }

    var timeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    if (status === 'Approve') {
      var meetCode = (enquiry.reference || 'meet') + '-' + Math.floor(100 + Math.random() * 900);
      var meetLink = 'https://meet.google.com/lookup/' + meetCode.toLowerCase();

      var subject = 'Your AI consultation is confirmed — Zatics Intelligence';
      var htmlBody = buildApprovalEmailHtml(enquiry, meetLink);

      sendResendDirect(recipients, subject, htmlBody);
      resultCell.setValue('✓ Approved: Confirmation & Meet sent (' + timeStr + ')');
    } else {
      var subject = 'Regarding your enquiry — Zatics Intelligence';
      var htmlBody = buildDeclineEmailHtml(enquiry);

      sendResendDirect(recipients, subject, htmlBody);
      resultCell.setValue('✓ Declined: Apology email sent (' + timeStr + ')');
    }
  } catch (err) {
    resultCell.setValue('⚠ Error: ' + err.message);
    Logger.log('Error processing row ' + row + ': ' + err.toString());
  }
}

/**
 * Automated Reminder Function (Runs every 10 mins).
 * Checks if meeting start time is roughly 1 hour away (between 5 and 75 mins from now).
 */
function checkAndSendReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet() || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROW) return;

  var now = new Date();
  var count = 0;

  for (var r = HEADER_ROW + 1; r <= lastRow; r++) {
    var rowValues = sheet.getRange(r, 1, 1, Math.max(REMINDER_COL, 12)).getValues()[0];
    var status = String(rowValues[STATUS_COL - 1] || '').trim();
    var reminderStatus = String(rowValues[REMINDER_COL - 1] || '').trim();

    // Only process approved rows that haven't had a reminder sent yet
    if (status === 'Approve' && reminderStatus.indexOf('Sent') === -1) {
      var dateVal = rowValues[6]; // Preferred Date
      var timeVal = rowValues[7]; // Preferred Time

      var meetingDate = parseDateTime(dateVal, timeVal);
      if (!meetingDate) continue;

      var diffMinutes = (meetingDate.getTime() - now.getTime()) / (1000 * 60);

      // Trigger if the meeting starts in 5 to 75 minutes (approx 1 hour before)
      if (diffMinutes >= 5 && diffMinutes <= 75) {
        var enquiry = {
          reference:      String(rowValues[0] || '').trim(),
          name:           String(rowValues[1] || '').trim(),
          email:          String(rowValues[2] || '').trim(),
          organisation:   String(rowValues[3] || '').trim(),
          interest:       String(rowValues[4] || '').trim(),
          message:        String(rowValues[5] || '').trim(),
          preferred_date: dateVal,
          preferred_time: timeVal
        };

        var recipients = buildRecipientList(enquiry.email);
        if (recipients.length === 0) continue;

        var meetCode = (enquiry.reference || 'meet') + '-' + Math.floor(100 + Math.random() * 900);
        var meetLink = 'https://meet.google.com/lookup/' + meetCode.toLowerCase();

        var subject = '⏰ Starting in 1 hour: Your AI Consultation with Zatics Intelligence';
        var htmlBody = buildReminderEmailHtml(enquiry, meetLink, meetingDate);

        try {
          sendResendDirect(recipients, subject, htmlBody);
          var timeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
          sheet.getRange(r, REMINDER_COL).setValue('✓ 1-Hour Reminder Sent (' + timeStr + ')');
          count++;
          Logger.log('1-Hour Reminder sent for row ' + r);
        } catch (e) {
          Logger.log('Failed to send reminder for row ' + r + ': ' + e.message);
          sheet.getRange(r, REMINDER_COL).setValue('⚠ Error: ' + e.message);
        }
      }
    }
  }

  if (count > 0) {
    Logger.log('Sent ' + count + ' 1-hour reminders.');
  }
}

/**
 * Builds recipient array containing the client and all configured ADMIN_EMAILS.
 */
function buildRecipientList(clientEmail) {
  var recipients = [];
  if (clientEmail && clientEmail.indexOf('@') !== -1) {
    recipients.push(clientEmail.trim());
  }

  if (typeof ADMIN_EMAILS !== 'undefined' && Array.isArray(ADMIN_EMAILS)) {
    for (var i = 0; i < ADMIN_EMAILS.length; i++) {
      var admin = String(ADMIN_EMAILS[i] || '').trim();
      if (admin && admin.indexOf('@') !== -1 && recipients.indexOf(admin) === -1) {
        recipients.push(admin);
      }
    }
  }
  return recipients;
}

/**
 * Parses date and time from cell inputs into a JavaScript Date.
 */
function parseDateTime(dateVal, timeVal) {
  if (!dateVal) return null;
  var dateStr = '';

  if (dateVal instanceof Date) {
    dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } else {
    dateStr = String(dateVal).trim();
  }

  var timeStr = '10:00';
  if (timeVal) {
    if (timeVal instanceof Date) {
      timeStr = Utilities.formatDate(timeVal, Session.getScriptTimeZone(), 'HH:mm');
    } else {
      var t = String(timeVal).trim();
      var m = t.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        var h = ('0' + m[1]).slice(-2);
        var min = m[2];
        timeStr = h + ':' + min;
      }
    }
  }

  var parsed = new Date(dateStr + 'T' + timeStr + ':00');
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Sends email via Resend API directly.
 */
function sendResendDirect(recipients, subject, htmlContent) {
  var url = 'https://api.resend.com/emails';
  var payload = {
    from: EMAIL_FROM,
    to: recipients,
    subject: subject,
    html: htmlContent
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Resend error (' + code + '): ' + body);
  }

  return JSON.parse(body);
}

/**
 * Test function: sends a test 1-hour reminder email right now.
 */
function testReminderEmail() {
  var ui = SpreadsheetApp.getUi();
  try {
    var dummy = {
      reference: 'REMIND-01',
      name: 'Rahul Mishra',
      organisation: 'Zatics Intelligence',
      interest: 'Enterprise AI & Automation',
      message: 'Discussion regarding upcoming AI deployment.',
      preferred_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      preferred_time: Utilities.formatDate(new Date(Date.now() + 3600000), Session.getScriptTimeZone(), 'HH:mm')
    };
    var meetLink = 'https://meet.google.com/lookup/zatics-reminder';
    var meetingTime = new Date(Date.now() + 3600000);
    var html = buildReminderEmailHtml(dummy, meetLink, meetingTime);

    var recipients = buildRecipientList('rahulmishra002003@gmail.com');
    var res = sendResendDirect(recipients, '⏰ [TEST] Starting in 1 hour: Your AI Consultation — Zatics Intelligence', html);
    ui.alert('Success! 1-Hour Reminder sent to ' + recipients.join(', ') + '\nResend ID: ' + res.id);
  } catch (e) {
    ui.alert('Failed to send reminder test: ' + e.message);
  }
}

/**
 * Test function: sends a test approval email.
 */
function testEmailNotification() {
  var ui = SpreadsheetApp.getUi();
  try {
    var dummy = {
      reference: 'TEST-001',
      name: 'Rahul Mishra',
      organisation: 'Zatics Tech',
      interest: 'Autonomous AI Agents',
      message: 'This is a test message to verify delivery.',
      preferred_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      preferred_time: '14:00'
    };
    var meetLink = 'https://meet.google.com/lookup/zatics-test';
    var html = buildApprovalEmailHtml(dummy, meetLink);

    var recipients = buildRecipientList('rahulmishra002003@gmail.com');
    var res = sendResendDirect(recipients, 'Test Consultation Confirmation — Zatics Intelligence', html);
    ui.alert('Success! Test email sent to ' + recipients.join(', ') + '\nResend ID: ' + res.id);
  } catch (e) {
    ui.alert('Failed to send email: ' + e.message);
  }
}

/**
 * 1-Hour Reminder Email Template
 */
function buildReminderEmailHtml(p, meetLink, meetingDate) {
  var yr = new Date().getFullYear();
  var formattedTime = Utilities.formatDate(meetingDate, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy @ hh:mm a');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#090b0a;font-family:sans-serif;color:#eeefea">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px">' +
    '<table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:32px 40px 0;text-align:center">' +
    '<p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE · 1-HOUR REMINDER</p>' +
    '<h1 style="margin:0;font-size:30px;font-weight:500;color:#eeefea">Your consultation starts<br/><span style="color:#d1f89a">in 1 hour.</span></h1></td></tr>' +
    '<tr><td style="padding:28px 40px">' +
    '<p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">' + (p.name || 'there') + '</strong>,<br/><br/>This is a quick reminder that our scheduled AI consultation for <strong style="color:#eeefea">' + (p.organisation || 'your team') + '</strong> is starting in approximately <strong>1 hour</strong>.</p>' +
    '<div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px">' +
    '<p style="margin:0 0 8px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">CALL SCHEDULE & DETAILS</p>' +
    '<p style="margin:0 0 8px">📅 <strong>Start Time:</strong> ' + formattedTime + '</p>' +
    '<p style="margin:0 0 8px"><strong>Reference:</strong> ZI-' + (p.reference || 'NEW') + '</p>' +
    '<p style="margin:0 0 8px"><strong>Area of Interest:</strong> ' + p.interest + '</p>' +
    '</div>' +
    '<div style="text-align:center;margin:28px 0">' +
    '<a href="' + meetLink + '" style="display:inline-block;background:#d1f89a;color:#172011;font-size:15px;font-weight:600;padding:16px 36px;border-radius:6px;text-decoration:none">🎥 Click to Join Google Meet</a>' +
    '<p style="margin:12px 0 0;font-size:11px;color:#5e6e51;font-family:monospace">' + meetLink + '</p>' +
    '</div>' +
    '<p style="margin:24px 0 0;font-size:12px;color:#5e6e51;line-height:1.7;text-align:center">Looking forward to connecting shortly.<br/>— <strong style="color:#93a381">Zatics Intelligence Team</strong></p>' +
    '</td></tr>' +
    '<tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14">' +
    '<p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ' + yr + ' ZATICS INTELLIGENCE</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

/**
 * Approval Email Template
 */
function buildApprovalEmailHtml(p, meetLink) {
  var yr = new Date().getFullYear();
  var schedNote = (p.preferred_date || p.preferred_time)
    ? '<p style="margin:0 0 8px">📅 <strong>Scheduled for:</strong> ' + (p.preferred_date || 'TBD') + (p.preferred_time ? ' at ' + p.preferred_time : '') + '</p>'
    : '<p style="margin:0 0 8px">📅 <strong>Schedule:</strong> We will confirm the exact time shortly.</p>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#090b0a;font-family:sans-serif;color:#eeefea">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px">' +
    '<table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:32px 40px 0;text-align:center">' +
    '<p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p>' +
    '<h1 style="margin:0;font-size:32px;font-weight:500;color:#eeefea">Your consultation<br/><span style="color:#d1f89a">is confirmed.</span></h1></td></tr>' +
    '<tr><td style="padding:28px 40px">' +
    '<p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">' + (p.name || 'there') + '</strong>,<br/><br/>We are excited to connect with you regarding AI solutions for <strong style="color:#eeefea">' + (p.organisation || 'your team') + '</strong>.</p>' +
    '<div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px">' +
    '<p style="margin:0 0 8px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">CONSULTATION DETAILS</p>' +
    '<p style="margin:0 0 8px"><strong>Reference:</strong> ZI-' + (p.reference || 'NEW') + '</p>' +
    '<p style="margin:0 0 8px"><strong>Name:</strong> ' + p.name + '</p>' +
    '<p style="margin:0 0 8px"><strong>Organisation:</strong> ' + p.organisation + '</p>' +
    '<p style="margin:0 0 8px"><strong>Area of Interest:</strong> ' + p.interest + '</p>' +
    '<p style="margin:0 0 8px"><strong>Your message:</strong><br/><span style="color:#93a381">' + (p.message || '').replace(/\n/g, '<br/>') + '</span></p>' +
    schedNote + '</div>' +
    '<div style="text-align:center;margin:28px 0">' +
    '<a href="' + meetLink + '" style="display:inline-block;background:#d1f89a;color:#172011;font-size:14px;font-weight:600;padding:16px 32px;border-radius:6px;text-decoration:none">🎥 Join Google Meet</a>' +
    '<p style="margin:12px 0 0;font-size:11px;color:#5e6e51;font-family:monospace">' + meetLink + '</p>' +
    '</div></td></tr>' +
    '<tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14">' +
    '<p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ' + yr + ' ZATICS INTELLIGENCE</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

/**
 * Decline Email Template
 */
function buildDeclineEmailHtml(p) {
  var yr = new Date().getFullYear();
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#090b0a;font-family:sans-serif;color:#eeefea">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px">' +
    '<table width="600" style="background:#10170d;border:1px solid #2e3d20;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:32px 40px 0;text-align:center">' +
    '<p style="margin:0 0 12px;font-size:9px;letter-spacing:2px;color:#8a9f70;font-family:monospace">ZATICS INTELLIGENCE</p>' +
    '<h1 style="margin:0;font-size:32px;font-weight:500;color:#eeefea">Thank you for<br/><span style="color:#93a381">reaching out.</span></h1></td></tr>' +
    '<tr><td style="padding:28px 40px">' +
    '<p style="margin:0 0 20px;font-size:14px;color:#93a381;line-height:1.7">Hi <strong style="color:#eeefea">' + (p.name || 'there') + '</strong>,<br/><br/>Thank you for sharing your project challenge with us — we genuinely appreciate your interest in Zatics Intelligence.<br/><br/>After reviewing your enquiry carefully, we don’t believe we are the right fit for your current requirements at this time. This may change as your needs evolve, and we’d welcome connecting in the future.</p>' +
    '<div style="background:#141c10;border:1px solid #2e3d20;border-radius:8px;padding:20px 24px;margin:0 0 24px">' +
    '<p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#8a9f70;font-family:monospace">YOUR REFERENCE</p>' +
    '<p style="margin:0;font-family:monospace;font-size:13px;color:#d1f89a">ZI-' + (p.reference || 'REF') + '</p>' +
    '</div><p style="margin:0;font-size:12px;color:#5e6e51;line-height:1.7;text-align:center">We wish you and <strong style="color:#93a381">' + (p.organisation || 'your team') + '</strong> every success.<br/>— <strong style="color:#93a381">The Zatics Intelligence team</strong></p></td></tr>' +
    '<tr><td style="background:#0a0f08;padding:20px 40px;text-align:center;border-top:1px solid #1e2a14">' +
    '<p style="margin:0;font-size:9px;letter-spacing:1px;color:#3e4e30;font-family:monospace">© ' + yr + ' ZATICS INTELLIGENCE</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}
