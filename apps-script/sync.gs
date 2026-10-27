/**
 * Solar master -> Solar Fleet web app.
 *
 * Sends the meter data the other scripts write into this sheet (Generation and
 * EB import tabs) to the web app's database, plus the office grid logger's last
 * reading time and the SolarOS token expiry. Tickets, planned work, settings and
 * systems now live in the web app, not here.
 *
 * Script Property needed: SOLAR_APP_KEY  (the sync key; it can only send readings)
 *
 * Functions to run by hand:
 *   syncNow            - sends the last 14 days now
 *   syncAll            - sends everything in the tabs (first run, or after fixing old rows)
 *   syncInstallTrigger - sends readings nightly at about 01:30 and the logger heartbeat hourly
 *   syncEbLines        - refreshes the EB lines tab from the app (also runs with every sync)
 *
 * EB import rows carry a line code (E01, E02 … from the EB lines tab) in the Line code column.
 */

var APP_URL = 'https://tmvrfhirwijczjgmydlx.supabase.co';
var APP_PUBLIC_KEY = 'sb_publishable_JXmVIuHetILBfpEwBqgMOA_vECFSx5V';
var SYNC_OFFICE_SHEET_ID = '1GruLWxpDe5oDSXxH0C5r-SEgMYiC0AHOFjlaWwUtz2c';
var SYNC_DAYS = 14;

function syncCall_(generation, eb, heartbeat) {
  var key = PropertiesService.getScriptProperties().getProperty('SOLAR_APP_KEY');
  if (!key) throw new Error('Set SOLAR_APP_KEY in Script Properties first.');
  var res = UrlFetchApp.fetch(APP_URL + '/rest/v1/rpc/solar_ingest', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: APP_PUBLIC_KEY, Authorization: 'Bearer ' + APP_PUBLIC_KEY },
    payload: JSON.stringify({ p_key: key, p_generation: generation || [], p_eb: eb || [], p_heartbeat: heartbeat || null }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Web app said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

function syncRows_(tabName, cols, sinceIso) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = ss.getSpreadsheetTimeZone();
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = values.shift().map(String);
  var idx = {}; head.forEach(function (h, i) { idx[h] = i; });
  var out = [];
  values.forEach(function (r) {
    var d = r[idx['Date']];
    var iso = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).slice(0, 10);
    var idCol = idx['System ID'] !== undefined ? idx['System ID'] : idx['Line code'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || idCol === undefined || !r[idCol]) return;
    if (sinceIso && iso < sinceIso) return;
    var o = { date: iso, system_id: String(r[idCol]).trim() };
    Object.keys(cols).forEach(function (k) {
      var i = idx[cols[k]];
      var v = i === undefined ? '' : r[i];
      o[k] = v === null || v === undefined ? '' : String(v);
    });
    out.push(o);
  });
  return out;
}

function syncHeartbeat_() {
  var hb = { key: 'office_logger' };
  try {
    var raw = SpreadsheetApp.openById(SYNC_OFFICE_SHEET_ID).getSheetByName('Raw');
    var last = String(raw.getRange(raw.getLastRow(), 1).getDisplayValue()).trim();
    var t = Date.parse(last.replace(' ', 'T') + '+05:30');
    if (!isNaN(t)) { hb.last_at = new Date(t).toISOString(); hb.detail = 'Last reading ' + last; }
  } catch (e) { Logger.log('Office sheet: ' + e.message); }
  try {
    var exp = SpreadsheetApp.getActive().getSheetByName('Settings').getRange('B6').getValue();
    if (exp instanceof Date) hb.solaros_token_expiry = Utilities.formatDate(exp, 'Asia/Kolkata', 'yyyy-MM-dd');
  } catch (e) { /* no Settings tab: skip */ }
  return hb.last_at ? hb : (hb.solaros_token_expiry ? { solaros_token_expiry: hb.solaros_token_expiry } : null);
}

/** Copies the app's EB lines (codes, tracking) into the sheet's EB lines tab. The app is the master list. */
function syncEbLines() {
  var key = PropertiesService.getScriptProperties().getProperty('SOLAR_APP_KEY');
  var res = UrlFetchApp.fetch(APP_URL + '/rest/v1/rpc/solar_eb_lines', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: APP_PUBLIC_KEY, Authorization: 'Bearer ' + APP_PUBLIC_KEY },
    payload: JSON.stringify({ p_key: key }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Web app said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  var lines = JSON.parse(res.getContentText());
  lines.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  var head = ['Line code', 'Site', 'EB connection', 'Service number', 'Tariff', 'Phase', 'Sanctioned kW', 'Tracking', 'Tracked via', 'Meter or device ID'];
  var rows = [head].concat(lines.map(function (l) {
    return [l.code, l.site, l.label, l.service_no || '', l.tariff || '', l.phase || '', l.sanctioned_kw == null ? '' : l.sanctioned_kw, l.tracking, l.tracked_via, l.device || ''];
  }));
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('EB lines') || ss.insertSheet('EB lines');
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), rows.length), head.length).clearContent();
  sh.getRange(1, 1, rows.length, head.length).setNumberFormat('@').setValues(rows);
  sh.setFrozenRows(1);
}

function sync_(sinceIso) {
  var gen = syncRows_('Generation', { kwh: 'kWh', source: 'Source', note: 'Note', load_kwh: 'Load kWh', from_grid_kwh: 'From grid kWh' }, sinceIso);
  try { syncEbLines(); } catch (e) { Logger.log('EB lines: ' + e.message); }
  var eb = syncRows_('EB import', { daylight_kwh: 'Daylight import kWh', day_kwh: 'Day import kWh', source: 'Source', note: 'Note' }, sinceIso);
  var r = syncCall_(gen, eb, syncHeartbeat_());
  Logger.log('Sent %s generation rows and %s grid import rows; %s skipped (system not in the app).', r.generation, r.eb, r.skipped);
  return r;
}

function syncNow() {
  var since = Utilities.formatDate(new Date(Date.now() - SYNC_DAYS * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd');
  return sync_(since);
}

function syncAll() { return sync_(null); }

function syncHeartbeat() {
  var hb = syncHeartbeat_();
  if (hb) syncCall_([], [], hb);
}

function syncInstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncNow', 'syncHeartbeat', 'ebDaily'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // the eb file works out daylight grid import; run it before the sync
  if (typeof ebDaily === 'function') {
    ScriptApp.newTrigger('ebDaily').timeBased().everyDays(1).atHour(0).nearMinute(45).inTimezone('Asia/Kolkata').create();
  }
  ScriptApp.newTrigger('syncNow').timeBased().everyDays(1).atHour(1).nearMinute(30).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('syncHeartbeat').timeBased().everyHours(1).create();
}
