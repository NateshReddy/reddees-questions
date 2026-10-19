/**
 * Reddee's Sales — website questions backend.
 *
 * Paste this into Extensions → Apps Script of the Google Sheet that should
 * collect the answers and change ACCESS_CODE below. Run setupPhotoFolder once
 * to approve Drive access, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * After any change to this file: Deploy → Manage deployments → Edit → New version.
 *
 * Every save is appended as a new row, so the full history is kept.
 * The page shows the latest answer for each question.
 */

// The code Dad's team types on the page. Change it before deploying.
const ACCESS_CODE = 'CHANGE-ME';

const SHEET_NAME = 'Answers';
const HEADERS = ['Time', 'Question ID', 'Section', 'Question', 'Answer', 'Answered by'];

// Uploaded photos and files go into this folder in your Google Drive,
// with one subfolder per item (Storefront, Team, Logo, ...).
const PHOTO_FOLDER_NAME = "Reddee's website photos";
const PHOTO_SHEET_NAME = 'Photos';
const PHOTO_HEADERS = ['Time', 'Question ID', 'Folder', 'File', 'Drive link', 'Uploaded by'];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
  const photos = {};
  const psh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PHOTO_SHEET_NAME);
  if (psh) {
    const pv = psh.getDataRange().getValues();
    for (let i = 1; i < pv.length; i++) {
      const r = pv[i];
      const qid = String(r[1] || '');
      if (!qid) continue;
      (photos[qid] = photos[qid] || []).push({
        fileName: String(r[3] || ''),
        name: String(r[5] || ''),
        time: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || '')
      });
    }
  }

  return json_({
    ok: true,
    answers: Object.keys(latest).map(function (k) { return latest[k]; }),
    photos: photos
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!codeOk_(body.code)) return json_({ ok: false, error: 'bad_code' });
  if (body.action === 'upload') return upload_(body);

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

// ---------- uploads ----------

function upload_(body) {
  const qid = clip_(body.qid, 80);
  const name = clip_(body.name, 80);
  if (!qid || !name || !body.data) return json_({ ok: false, error: 'missing_fields' });

  let bytes;
  try {
    bytes = Utilities.base64Decode(String(body.data));
  } catch (err) {
    return json_({ ok: false, error: 'bad_file' });
  }
  if (!bytes.length) return json_({ ok: false, error: 'bad_file' });
  if (bytes.length > MAX_UPLOAD_BYTES) return json_({ ok: false, error: 'too_large' });

  const folderName = cleanName_(clip_(body.folder, 60)) || qid;
  const original = cleanName_(clip_(body.fileName, 120)) || 'photo.jpg';
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const fileName = folderName + ' - ' + cleanName_(name) + ' - ' +
    Utilities.formatDate(now, tz, 'yyyy-MM-dd HHmmss') + ' - ' + original;
  const mime = clip_(body.mimeType, 100) || 'application/octet-stream';

  // Folder lookups under the lock so two uploads never create duplicate folders.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try {
    folder = subfolder_(folderName);
  } finally {
    lock.releaseLock();
  }

  const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));

  lock.waitLock(10000);
  try {
    const sh = photoSheet_();
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, PHOTO_HEADERS.length)
      .setNumberFormats([['dd MMM yyyy, h:mm am/pm', '@', '@', '@', '@', '@']])
      .setValues([[now, qid, folderName, fileName, file.getUrl(), name]]);
  } finally {
    lock.releaseLock();
  }

  return json_({ ok: true, file: { qid: qid, fileName: fileName, name: name, time: now.toISOString() } });
}

function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* folder deleted: make a new one */ }
  }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function subfolder_(name) {
  const root = rootFolder_();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function photoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PHOTO_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PHOTO_SHEET_NAME);
    sh.appendRow(PHOTO_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, PHOTO_HEADERS.length).setFontWeight('bold');
    sh.setColumnWidth(4, 360);
  }
  return sh;
}

function cleanName_(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Run this once from the Apps Script editor (select it, click Run) to approve
// Google Drive access and create the photos folder before deploying.
function setupPhotoFolder() {
  const f = rootFolder_();
  Logger.log('Photos will be saved in: ' + f.getUrl());
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
