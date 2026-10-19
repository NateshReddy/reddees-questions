/**
 * Reddee's Sales — website questions backend.
 *
 * Paste this into Extensions → Apps Script of the Google Sheet that should
 * collect the answers, change ACCESS_CODE below, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Every save is appended as a new row, so the full history is kept.
 * The page shows the latest answer for each question.
 */

// The code Dad's team types on the page. Change it before deploying.
const ACCESS_CODE = 'CHANGE-ME';

const SHEET_NAME = 'Answers';
const HEADERS = ['Time', 'Question ID', 'Section', 'Question', 'Answer', 'Answered by'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!codeOk_(p.code)) return json_({ ok: false, error: 'bad_code' });

  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  const latest = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const qid = String(r[1] || '');
    if (!qid) continue;
    latest[qid] = {
      qid: qid,
      answer: String(r[4] == null ? '' : r[4]),
      name: String(r[5] || ''),
      time: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || '')
    };
  }
  return json_({ ok: true, answers: Object.keys(latest).map(function (k) { return latest[k]; }) });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!codeOk_(body.code)) return json_({ ok: false, error: 'bad_code' });

  const qid = clip_(body.qid, 80);
  const name = clip_(body.name, 80);
  if (!qid || !name) return json_({ ok: false, error: 'missing_fields' });

  const answer = clip_(body.answer, 5000);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    const sh = sheet_();
    const row = sh.getLastRow() + 1;
    // Plain-text format first, so answers like "9822221933", "10/12" or "=..."
    // are kept exactly as typed instead of turning into numbers, dates or formulas.
    sh.getRange(row, 1, 1, HEADERS.length)
      .setNumberFormats([['dd MMM yyyy, h:mm am/pm', '@', '@', '@', '@', '@']])
      .setValues([[now, qid, clip_(body.section, 120), clip_(body.question, 600), answer, name]]);
    return json_({ ok: true, row: { qid: qid, answer: answer, name: name, time: now.toISOString() } });
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

function codeOk_(code) {
  return typeof code === 'string' && code.trim() === ACCESS_CODE;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setColumnWidth(4, 360);
    sh.setColumnWidth(5, 360);
  }
  return sh;
}

function clip_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
