/**
 * Reddee's Sales — website questions backend.
 *
 * Paste this into Extensions → Apps Script of the Google Sheet that should
 * collect the answers and change ACCESS_CODE below. Run setupPhotoFolder and
 * setupVideoUploads once each to approve Google permissions, then
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

// Videos and other big files are sent in pieces and joined by Google Drive.
// Each piece must be a multiple of 256 KB (except the last).
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

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
  if (body.action === 'big_start') return bigStart_(body);
  if (body.action === 'big_chunk') return bigChunk_(body);
  if (body.action === 'big_status') return bigStatus_(body);

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
  logUpload_(now, qid, folderName, fileName, file.getUrl(), name);
  return json_({ ok: true, file: { qid: qid, fileName: fileName, name: name, time: now.toISOString() } });
}

function logUpload_(when, qid, folderName, fileName, url, name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = photoSheet_();
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, PHOTO_HEADERS.length)
      .setNumberFormats([['dd MMM yyyy, h:mm am/pm', '@', '@', '@', '@', '@']])
      .setValues([[when, qid, folderName, fileName, url, name]]);
  } finally {
    lock.releaseLock();
  }
}

function makeFileName_(folderName, name, original) {
  return folderName + ' - ' + cleanName_(name) + ' - ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss') + ' - ' + original;
}

// ---------- big uploads (videos) ----------
// The page sends the file in pieces; this script passes each piece on to a
// Google Drive "resumable upload" session, so files of any size up to
// MAX_VIDEO_BYTES end up as one file in Drive.

function bigStart_(body) {
  const qid = clip_(body.qid, 80);
  const name = clip_(body.name, 80);
  const size = Number(body.size);
  if (!qid || !name || !(size > 0)) return json_({ ok: false, error: 'missing_fields' });
  if (size > MAX_VIDEO_BYTES) return json_({ ok: false, error: 'too_large' });

  const folderName = cleanName_(clip_(body.folder, 60)) || qid;
  const original = cleanName_(clip_(body.fileName, 120)) || 'video.mp4';
  const fileName = makeFileName_(folderName, name, original);
  const mime = clip_(body.mimeType, 100) || 'application/octet-stream';

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try {
    folder = subfolder_(folderName);
  } finally {
    lock.releaseLock();
  }

  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink',
    {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({ name: fileName, mimeType: mime, parents: [folder.getId()] }),
      muteHttpExceptions: true
    }
  );
  const uri = header_(res, 'Location');
  if (res.getResponseCode() !== 200 || !uri) {
    return json_({ ok: false, error: 'start_failed', status: res.getResponseCode() });
  }

  const uploadId = Utilities.getUuid();
  CacheService.getScriptCache().put('big_' + uploadId, JSON.stringify({
    uri: uri, qid: qid, folderName: folderName, fileName: fileName, name: name, size: size
  }), 21600);
  return json_({ ok: true, uploadId: uploadId, chunkSize: CHUNK_BYTES });
}

function bigChunk_(body) {
  const job = bigJob_(body.uploadId);
  if (!job) return json_({ ok: false, error: 'upload_expired' });
  const offset = Number(body.offset);
  let bytes;
  try {
    bytes = Utilities.base64Decode(String(body.data || ''));
  } catch (err) {
    return json_({ ok: false, error: 'bad_file' });
  }
  if (!bytes.length || !(offset >= 0) || offset + bytes.length > job.size) {
    return json_({ ok: false, error: 'bad_chunk' });
  }
  const res = UrlFetchApp.fetch(job.uri, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + bytes.length - 1) + '/' + job.size },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false
  });
  return bigResult_(body.uploadId, job, res);
}

// Asks Drive how much of the file has arrived (used to resume after a dropped connection).
function bigStatus_(body) {
  const job = bigJob_(body.uploadId);
  if (!job) return json_({ ok: false, error: 'upload_expired' });
  const res = UrlFetchApp.fetch(job.uri, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + job.size },
    payload: '',
    muteHttpExceptions: true,
    followRedirects: false
  });
  return bigResult_(body.uploadId, job, res);
}

function bigResult_(uploadId, job, res) {
  const code = res.getResponseCode();
  if (code === 308) {
    const range = header_(res, 'Range'); // e.g. "bytes=0-8388607"
    const m = range && /-(\d+)$/.exec(range);
    return json_({ ok: true, received: m ? Number(m[1]) + 1 : 0 });
  }
  if (code === 200 || code === 201) {
    let info = {};
    try { info = JSON.parse(res.getContentText()); } catch (err) { /* keep going */ }
    const url = info.webViewLink || (info.id ? 'https://drive.google.com/file/d/' + info.id + '/view' : '');
    const cache = CacheService.getScriptCache();
    const now = new Date();
    if (!cache.get('bigdone_' + uploadId)) {
      cache.put('bigdone_' + uploadId, '1', 21600);
      logUpload_(now, job.qid, job.folderName, job.fileName, url, job.name);
    }
    return json_({ ok: true, done: true, file: { qid: job.qid, fileName: job.fileName, name: job.name, time: now.toISOString() } });
  }
  if (code === 404 || code === 410) return json_({ ok: false, error: 'upload_expired' });
  return json_({ ok: false, error: 'chunk_failed', status: code });
}

function bigJob_(uploadId) {
  if (!uploadId) return null;
  const raw = CacheService.getScriptCache().get('big_' + String(uploadId).slice(0, 64));
  return raw ? JSON.parse(raw) : null;
}

function header_(res, name) {
  const h = res.getHeaders() || {};
  const want = name.toLowerCase();
  for (const k in h) {
    if (k.toLowerCase() === want) return Array.isArray(h[k]) ? h[k][0] : h[k];
  }
  return '';
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

// Run this once (select it, click Run) to approve the extra permission video
// uploads need ("connect to an external service", used to talk to Google Drive),
// and to check that it works.
function setupVideoUploads() {
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    Logger.log('Video uploads are ready. Videos will go to Drive for ' +
      JSON.parse(res.getContentText()).user.emailAddress + ', in: ' + rootFolder_().getUrl());
  } else {
    Logger.log('Something went wrong (' + res.getResponseCode() + '): ' + res.getContentText());
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
