/**
 * EB (grid) import -> "Solar master" EB import tab.
 *
 * One row per system per day: units taken from the grid during the daylight
 * window (Settings: Daylight start / Daylight end) and over the whole day.
 *
 *   Office (S30)  from the office grid meter log ("LM3B office — grid meter log",
 *                 Raw tab, cumulative import counter every 10 minutes).
 *   Hybrids       from SolarOS's day curve (grid power through the day) and its
 *                 daily total. Uses SOLAROS_TOKEN and helpers from the solaros file.
 *
 * A day whose readings don't cover the window is marked "Partial: ...", which
 * keeps it out of the "above usual" baseline and its ticket check.
 *
 * Functions to run by hand:
 *   ebDump  - prints what would be written. Writes nothing.
 *   ebDaily - writes every missing complete day (office: all history; hybrids: last 3 days)
 * The nightly trigger is installed by installAll in the tickets file.
 */

var EB_OFFICE_SHEET_ID = '1GruLWxpDe5oDSXxH0C5r-SEgMYiC0AHOFjlaWwUtz2c';
var EB_OFFICE_SYSTEM_ID = 'S30';
var EB_TZ = 'Asia/Kolkata';
var EB_MAX_GAP_MIN = 40;        // a boundary is read only if readings sit within this of it
var EB_MAX_STEP_MIN = 20;       // curve steps longer than this count as missing
var EB_HYBRID_DAYS_BACK = 3;

function ebWindow_() {
  var rows = SpreadsheetApp.getActive().getSheetByName('Settings').getRange('A1:B30').getDisplayValues();
  var get = function (name, dflt) {
    for (var i = 0; i < rows.length; i++) if (rows[i][0] === name) return rows[i][1];
    return dflt;
  };
  var toMin = function (s) { var p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); };
  return { start: toMin(get('Daylight start', '06:30')), end: toMin(get('Daylight end', '17:30')) };
}

function ebHm_(min) { return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + Math.round(min % 60)).slice(-2); }

/** Days already written, as { 'yyyy-MM-dd|S30': rowNumber } */
function ebExisting_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('EB import');
  var tz = ss.getSpreadsheetTimeZone();
  var out = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r, i) {
      var d = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]);
      out[d + '|' + r[1]] = { row: i + 2, daylight: r[2], note: r[5] };
    });
  }
  return out;
}

/* ---------- Office grid meter ---------- */

function ebOfficeDays_() {
  var win = ebWindow_();
  var sh = SpreadsheetApp.openById(EB_OFFICE_SHEET_ID).getSheetByName('Raw');
  var last = sh.getLastRow();
  if (last < 2) return {};
  var ts = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  var imp = sh.getRange(2, 32, last - 1, 1).getValues();        // AF = import_kwh
  var pts = [];
  for (var i = 0; i < ts.length; i++) {
    var t = Date.parse(String(ts[i][0]).trim().replace(' ', 'T') + '+05:30');
    var v = Number(imp[i][0]);
    if (!isNaN(t) && imp[i][0] !== '' && !isNaN(v)) pts.push([t, v]);
  }
  pts.sort(function (a, b) { return a[0] - b[0]; });
  if (!pts.length) return {};

  // counter at an instant, interpolated between the readings either side
  var at = function (t) {
    var lo = 0, hi = pts.length - 1;
    if (t < pts[0][0] || t > pts[hi][0]) return null;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
    var a = pts[lo], b = pts[hi];
    if (Math.max(t - a[0], b[0] - t) > EB_MAX_GAP_MIN * 60000) return null;
    if (b[0] === a[0]) return a[1];
    return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
  };

  var today = Utilities.formatDate(new Date(), EB_TZ, 'yyyy-MM-dd');
  var first = Utilities.formatDate(new Date(pts[0][0]), EB_TZ, 'yyyy-MM-dd');
  var out = {};
  for (var d = first; d < today; d = Utilities.formatDate(new Date(Date.parse(d + 'T12:00:00+05:30') + 86400000), EB_TZ, 'yyyy-MM-dd')) {
    var midnight = Date.parse(d + 'T00:00:00+05:30');
    var s = at(midnight + win.start * 60000), e = at(midnight + win.end * 60000);
    var d0 = at(midnight), d1 = at(midnight + 86400000);
    var notes = [];
    var daylight = (s !== null && e !== null) ? Math.round((e - s) * 10) / 10 : '';
    if (daylight === '') notes.push('no readings at ' + (s === null ? ebHm_(win.start) : ebHm_(win.end)));
    var day = (d0 !== null && d1 !== null) ? Math.round((d1 - d0) * 10) / 10 : '';
    if (day === '' && daylight !== '') notes.push('whole-day figure missing');
    if (daylight === '' && day === '') continue;          // nothing usable that day
    out[d] = { daylight: daylight, day: day, note: notes.length ? 'Partial: ' + notes.join('; ') : '' };
  }
  return out;
}

/* ---------- Hybrids via SolarOS ---------- */

function ebHybridSystems_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Systems');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  return rows.filter(function (r) {
    return r[0] && String(r[3]).toLowerCase() === 'hybrid' && String(r[9]).toLowerCase().indexOf('solaros') === 0 &&
           String(r[10]).trim() && r[11] === 'Live';
  }).map(function (r) { return { id: r[0], station: String(r[10]).trim() }; });
}

function ebHybridDay_(token, station, ymd, win) {
  var p = ymd.split('-');
  var url = SOLAROS_HOST + '/maintain-s/history/batteryPower/' + station + '/stats/daily?year=' + Number(p[0]) +
            '&month=' + Number(p[1]) + '&day=' + Number(p[2]);
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() === 401) throw new Error('SolarOS says 401: the token has expired or was pasted wrong.');
  if (res.getResponseCode() !== 200) throw new Error('SolarOS HTTP ' + res.getResponseCode() + ' for station ' + station);
  var j = JSON.parse(res.getContentText());
  var st = j.statistics || {};
  if (st.buyValue === null || st.buyValue === undefined) return null;
  var pts = (j.records || []).filter(function (r) { return r.buyPower !== null && r.buyPower !== undefined && r.dateTime; })
    .map(function (r) { return [Number(r.dateTime), Number(r.buyPower) / 1000]; })        // seconds, kW
    .sort(function (a, b) { return a[0] - b[0]; });
  var midnight = Date.parse(ymd + 'T00:00:00+05:30') / 1000;
  var ws = midnight + win.start * 60, we = midnight + win.end * 60;
  var kwh = 0, covered = 0;
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i];
    if ((b[0] - a[0]) / 60 > EB_MAX_STEP_MIN || b[0] <= a[0]) continue;
    var t1 = Math.max(a[0], ws), t2 = Math.min(b[0], we);
    if (t2 <= t1) continue;
    var slope = (b[1] - a[1]) / (b[0] - a[0]);
    var p1 = a[1] + slope * (t1 - a[0]), p2 = a[1] + slope * (t2 - a[0]);
    kwh += (p1 + p2) / 2 * (t2 - t1) / 3600;
    covered += t2 - t1;
  }
  var share = covered / (we - ws);
  return {
    daylight: share > 0 ? Math.round(kwh * 10) / 10 : '',
    day: Math.round(Number(st.buyValue) * 10) / 10,
    note: share < 0.8 ? 'Partial: readings cover ' + Math.round(share * 100) + '% of daylight' : ''
  };
}

function ebHybridDays_() {
  var win = ebWindow_();
  var token = solarosToken_();
  var days = [];
  var now = new Date();
  for (var k = EB_HYBRID_DAYS_BACK; k >= 1; k--) days.push(Utilities.formatDate(new Date(now.getTime() - k * 86400000), EB_TZ, 'yyyy-MM-dd'));
  var out = [];
  ebHybridSystems_().forEach(function (s) {
    days.forEach(function (d) {
      try {
        var r = ebHybridDay_(token, s.station, d, win);
        if (r) out.push({ date: d, id: s.id, daylight: r.daylight, day: r.day, note: r.note });
      } catch (e) {
        Logger.log('%s %s: %s', s.id, d, e.message);
      }
    });
  });
  return out;
}

/* ---------- Writing ---------- */

function ebAll_() {
  var rows = [];
  var office = ebOfficeDays_();
  Object.keys(office).sort().forEach(function (d) {
    rows.push({ date: d, id: EB_OFFICE_SYSTEM_ID, daylight: office[d].daylight, day: office[d].day, note: office[d].note, source: 'Office grid meter' });
  });
  ebHybridDays_().forEach(function (r) { r.source = 'SolarOS'; rows.push(r); });
  return rows;
}

function ebDump() {
  ebAll_().forEach(function (r) {
    Logger.log('%s %s  daylight %s  day %s  %s', r.date, r.id, r.daylight, r.day, r.note);
  });
}

function ebDaily() {
  var sh = SpreadsheetApp.getActive().getSheetByName('EB import');
  var have = ebExisting_();
  ebAll_().forEach(function (r) {
    var h = have[r.date + '|' + r.id];
    if (!h) {
      sh.appendRow([r.date, r.id, r.daylight, r.day, r.source, r.note]);
    } else if (String(h.note).indexOf('Partial') === 0 || h.daylight === '') {
      // a partial day can still improve as late readings arrive
      sh.getRange(h.row, 3, 1, 4).setValues([[r.daylight, r.day, r.source, r.note]]);
    }
  });
}
