const RAW_SHEET = 'raw';
const MERGED_SHEET = 'merged';
const RAW_HEADERS = ['server_time', 'submission_id', 'pair_id', 'stage', 'session', 'session_raw', 'lang', 'questions_version', 'client_time', 'user_agent', 'data'];
const STAGE_TIME_COLUMN = { pre: 'pre_submitted_at', post: 'post_submitted_at', feedback: 'completed_at' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const CODE_RE = /^[^\u0000-\u001f]{0,64}$/;
const MAX_BODY = 20000;
const MAX_KEYS = 100;
const MAX_VALUE = 1000;
const QUESTIONS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6ThHT1bFOAGrsF5m5eRn42bQ2N4fPesyBzscD07LBhBf4DEMTUHeMMD4aH9R35UOGFOROuO16njDz/pub?gid=403739147&single=true&output=csv';
const OPTIONS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6ThHT1bFOAGrsF5m5eRn42bQ2N4fPesyBzscD07LBhBf4DEMTUHeMMD4aH9R35UOGFOROuO16njDz/pub?gid=1086851046&single=true&output=csv';
const FIXED_DESCRIPTIONS = {
  pair_id: '匿名配對碼（同一支手機的前測、後測、回饋為同一個）',
  session: '場次代碼（未指定或未啟用的場次記為 default）',
  session_raw: '網址上原始的場次參數 ?s=',
  lang: '作答語言（zh 中文／en 英文）',
  questions_version: '作答時的題目版本',
  consent: '同意參加（1 = 已勾選同意）',
  pre_duration: '前測作答時長（秒，前測頁出現到送出）',
  video_completed: '是否看完衛教影片（1 = 已看完）',
  post_duration: '後測作答時長（秒，後測頁出現到送出）',
  pre_submitted_at: '前測送出時間（伺服器時間）',
  post_submitted_at: '後測送出時間（伺服器時間）',
  completed_at: '活動回饋送出時間（伺服器時間）',
  user_agent: '填答裝置與瀏覽器資訊'
};
const RENAMED_KEYS = { pre_seconds: 'pre_duration', post_seconds: 'post_duration' };
const LEADING_COLUMNS = ['completed_at', 'session', 'session_raw', 'lang', 'questions_version'];
const TRAILING_COLUMNS = ['pre_submitted_at', 'post_submitted_at', 'pair_id', 'user_agent'];

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > MAX_BODY) {
    return out_({ ok: false, rejected: true, error: 'invalid body' });
  }
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, rejected: true, error: 'invalid json' });
  }
  const problem = validate_(body);
  if (problem) return out_({ ok: false, rejected: true, error: problem });
  if (body.website) return out_({ ok: true });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return out_({ ok: false, error: 'busy' });
  try {
    sheet_(RAW_SHEET, RAW_HEADERS).appendRow([
      new Date(),
      body.submission_id,
      body.pair_id,
      body.stage,
      safe_(body.session),
      safe_(body.session_raw),
      body.lang,
      safe_(body.questions_version),
      safe_(body.client_time),
      safe_(body.user_agent),
      JSON.stringify(body.data)
    ]);
  } finally {
    lock.releaseLock();
  }
  return out_({ ok: true });
}

function validate_(b) {
  if (!b || typeof b !== 'object') return 'invalid payload';
  if (!UUID_RE.test(String(b.pair_id || ''))) return 'invalid pair_id';
  if (!UUID_RE.test(String(b.submission_id || ''))) return 'invalid submission_id';
  if (!STAGE_TIME_COLUMN.hasOwnProperty(b.stage)) return 'invalid stage';
  if (b.lang !== 'zh' && b.lang !== 'en') return 'invalid lang';
  if (!CODE_RE.test(String(b.session || ''))) return 'invalid session';
  if (!CODE_RE.test(String(b.session_raw || ''))) return 'invalid session_raw';
  if (String(b.questions_version || '').length > 64) return 'invalid questions_version';
  if (String(b.client_time || '').length > 40) return 'invalid client_time';
  if (String(b.user_agent || '').length > 300) return 'invalid user_agent';
  const d = b.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'invalid data';
  const keys = Object.keys(d);
  if (keys.length > MAX_KEYS) return 'too many fields';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = d[k];
    if (!KEY_RE.test(k)) return 'invalid field name';
    if (v !== null && ['string', 'number', 'boolean'].indexOf(typeof v) === -1) return 'invalid field value';
    if (typeof v === 'string' && v.length > MAX_VALUE) return 'field too long';
  }
  return '';
}

function mergeResponses() {
  const raw = sheet_(RAW_SHEET, RAW_HEADERS);
  const values = raw.getDataRange().getValues();
  const head = values.shift() || [];
  const idx = {};
  head.forEach(function (h, i) { idx[h] = i; });

  const seen = {};
  const people = {};
  const order = [];
  const dataKeys = [];
  const keySeen = {};

  values.forEach(function (r) {
    const sid = r[idx.submission_id];
    const pid = r[idx.pair_id];
    if (!sid || !pid || seen[sid]) return;
    seen[sid] = true;
    let data;
    try {
      data = JSON.parse(r[idx.data]);
    } catch (err) {
      return;
    }
    if (!people[pid]) {
      people[pid] = { pair_id: pid, session: '', session_raw: '', lang: '', questions_version: '', pre_submitted_at: '', post_submitted_at: '', completed_at: '', user_agent: '' };
      order.push(pid);
    }
    const p = people[pid];
    p.session = p.session || r[idx.session];
    p.session_raw = p.session_raw || r[idx.session_raw];
    p.lang = r[idx.lang] || p.lang;
    p.questions_version = p.questions_version || r[idx.questions_version];
    p.user_agent = p.user_agent || r[idx.user_agent];
    const col = STAGE_TIME_COLUMN[r[idx.stage]];
    if (col && !p[col]) p[col] = r[idx.server_time];
    Object.keys(data).forEach(function (key) {
      const k = RENAMED_KEYS[key] || key;
      if (!keySeen[k]) {
        keySeen[k] = true;
        dataKeys.push(k);
      }
      p[k] = data[key];
    });
  });

  const headers = LEADING_COLUMNS.concat(dataKeys).concat(TRAILING_COLUMNS);
  const rows = order.map(function (pid) {
    return headers.map(function (h) { return cell_(people[pid][h]); });
  });

  const descriptions = describe_(headers);

  const merged = sheet_(MERGED_SHEET, headers);
  merged.clearContents();
  merged.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  merged.getRange(2, 1, 1, headers.length).setValues([descriptions])
    .setFontStyle('italic').setFontColor('#666666').setBackground('#f3f3f3')
    .setWrap(true).setVerticalAlignment('top');
  if (rows.length) merged.getRange(3, 1, rows.length, headers.length).setValues(rows);
  merged.setFrozenRows(2);
}

function describe_(headers) {
  const questions = {};
  const options = {};
  try {
    csvObjects_(QUESTIONS_CSV_URL).forEach(function (q) { questions[q.id] = q; });
    csvObjects_(OPTIONS_CSV_URL).forEach(function (o) {
      (options[o.set] = options[o.set] || []).push(o);
    });
  } catch (err) {
    console.warn('讀取題目設定失敗：' + err);
  }
  return headers.map(function (h) {
    if (FIXED_DESCRIPTIONS[h]) return FIXED_DESCRIPTIONS[h];
    const m = /^(.+?)(_pre|_post)?(_other)?$/.exec(h);
    const q = questions[m[1]];
    if (!q) return '';
    const stage = m[2] === '_pre' ? '【前測】' : m[2] === '_post' ? '【後測】' : '';
    const text = String(q.zh_text || '').split('\n')[0];
    if (m[3]) return safe_(stage + text + '：選「其他」時填寫的內容');
    let desc = stage + text;
    const opts = (options[q.option_set] || []).slice().sort(function (a, b) { return Number(a.order) - Number(b.order); });
    if (q.type === 'single' && opts.length) {
      desc += '\n選項：' + opts.map(function (o) { return o.value + '=' + o.zh_label; }).join('；');
    }
    if (q.type === 'number' && q.unit_zh) desc += '（單位：' + q.unit_zh + '）';
    if (q.correct_answer) desc += '\n正確答案：' + q.correct_answer;
    return safe_(desc);
  });
}

function csvObjects_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  const rows = Utilities.parseCsv(res.getContentText('UTF-8'));
  const head = rows.shift() || [];
  return rows.map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[String(h).replace(/^\uFEFF/, '').trim()] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

function setup() {
  sheet_(RAW_SHEET, RAW_HEADERS);
  sheet_(MERGED_SHEET, ['pair_id']);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'mergeResponses') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('mergeResponses').timeBased().everyMinutes(10).create();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('問卷工具')
    .addItem('立即合併資料（更新 merged 分頁）', 'mergeResponses')
    .addItem('初始化（建立分頁與自動合併排程）', 'setup')
    .addToUi();
}

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function cell_(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
  return safe_(s);
}

function safe_(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
