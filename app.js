/* Solar Fleet web app. Plain JavaScript; Supabase for data and logins, d3 for charts. */
(function () {
  'use strict';
  const cfg = window.SOLAR_CONFIG;
  const sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true } });
  const $ = (s, r = document) => r.querySelector(s);
  const main = $('#main');
  const state = { user: null, me: null, settings: {} };

  /* ---------- small helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const n1 = (v) => (v == null || v === '' ? '—' : d3.format(',.1f')(+v));
  const n0 = (v) => (v == null || v === '' ? '—' : d3.format(',.0f')(+v));
  const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
  const fmtDay = (iso) => (iso ? d3.utcFormat('%-d %b')(new Date(iso + 'T00:00:00Z')) : '—');
  const fmtDate = (iso) => (iso ? d3.utcFormat('%-d %b %Y')(new Date(iso.slice(0, 10) + 'T00:00:00Z')) : '—');
  const tno = (id) => 'T-' + String(id).padStart(4, '0');
  const canWrite = () => state.me && (state.me.role === 'owner' || state.me.role === 'admin');
  const isOwner = () => state.me && state.me.role === 'owner';

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3000);
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) { toast(error.message, true); throw error; }
    return data;
  }
  function field(label, input, cls) { return h('div', { class: 'field' + (cls ? ' ' + cls : '') }, h('label', { for: input.id }, label), input); }
  function input(id, value, attrs = {}) { return h('input', { id, value: value ?? '', ...attrs }); }
  function select(id, value, options) {
    const s = h('select', { id }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, l); }));
    s.value = value ?? '';
    return s;
  }
  function openDialog(content) {
    const d = $('#dialog');
    d.replaceChildren(content);
    if (!d.open) d.showModal();
    return d;
  }
  const closeDialog = () => $('#dialog').close();
  function pageHead(title, sub, ...right) {
    return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), right.length ? h('div', { class: 'actions' }, right) : null);
  }

  /* ---------- auth ---------- */
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return showLogin();
    state.user = data.session.user;
    const me = await sb.from('solar_users').select('*').eq('user_id', state.user.id).maybeSingle();
    if (!me.data) {
      showLogin('This login is not set up for Solar Fleet yet. Ask the owner to add you.');
      await sb.auth.signOut();
      return;
    }
    state.me = me.data;
    const s = await q(sb.from('solar_settings').select('*').order('sort'));
    state.settings = Object.fromEntries(s.map((r) => [r.key, r.value]));
    $('#login').hidden = true; $('#app').hidden = false;
    $('#who').textContent = state.me.name + ' · ' + state.me.role;
    // staff see spoken-Tamil help lines by default; anyone can switch them off from the menu
    if (window.SolarTamil && !state.taStarted) { state.taStarted = true; SolarTamil.start(state.me.role !== 'owner'); $('#ta-toggle').addEventListener('click', () => SolarTamil.toggle()); }
    route();
    refreshCounts();
  }
  function showLogin(msg) {
    $('#app').hidden = true; $('#login').hidden = false;
    const e = $('#login-error'); e.hidden = !msg; e.textContent = msg || '';
  }
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let u = $('#login-user').value.trim();
    if (!u.includes('@')) u = u.toLowerCase() + '@' + cfg.loginDomain;
    const { error } = await sb.auth.signInWithPassword({ email: u, password: $('#login-pass').value });
    if (error) return showLogin('That username and password did not match. Check them and try again.');
    $('#login-pass').value = '';
    boot();
  });
  $('#signout').addEventListener('click', async () => { await sb.auth.signOut(); location.hash = ''; showLogin(); });

  async function refreshCounts() {
    const open = await sb.from('solar_tickets').select('id, due, status, type').neq('status', 'Closed');
    const od = (open.data || []).filter((t) => t.type !== 'Setup').length;
    $('#nav-tickets').textContent = od || '';
    const bills = await sb.from('solar_eb_bills').select('id', { count: 'exact', head: true }).eq('status', 'Submitted');
    $('#nav-bills').textContent = bills.count || '';
  }

  /* ---------- routing ---------- */
  const routes = { overview, tickets, ticket, bills, grid, sites: sitesPage, systems, planned, settings, users, bulk, sitetable: siteTable, site: sitePage, system: systemPage, setup, checklist, energy, companies, slip };
  const SETUP_PAGES = ['sites', 'grid', 'planned', 'bulk', 'settings', 'users', 'systems', 'sitetable', 'companies'];
  function route() {
    const [name, arg] = (location.hash.slice(1) || 'overview').split('/');
    const fn = routes[name] || overview;
    document.querySelectorAll('.side a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === (name === 'ticket' ? 'tickets' : name === 'site' ? 'overview' : name === 'system' ? 'overview' : name === 'slip' ? 'bills' : SETUP_PAGES.includes(name) ? 'setup' : name)));
    if (name !== 'sites') window.scrollTo(0, 0);
    document.querySelectorAll('.side a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
    main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    Promise.resolve(fn(arg)).then(() => {
      // every page under Setup leads back to it
      if (SETUP_PAGES.includes(name) && !main.querySelector(':scope > .back')) main.prepend(h('a', { class: 'back', href: '#setup' }, '← Setup'));
    }).catch((e) => { main.replaceChildren(h('p', { class: 'error' }, 'This page could not load: ' + (e.message || e))); });
    main.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => state.me && route());

  /* ---------- setup: the pages needed now and then ---------- */
  function setup() {
    const items = [
      ['#systems', 'Systems', 'Every solar system, by site. Open one to see its readings and complaints.'],
      ['#sitetable', 'Site table', 'All sites side by side with their last three bills.'],
      ['#companies', 'Companies', 'Which company each site is under, and the account its EB bills are paid from.'],
      ['#sites', 'Sites and EB connections', 'Add a site, an EB connection or a solar system, and edit their details.'],
      ['#grid', 'Daylight grid import', 'Units each metered EB line takes during the day. Fills in once EB meters are fitted.'],
      ['#planned', 'Planned work', 'Tell the nightly checks about planned shutdowns so they raise no fault tickets.'],
      ['#bulk', 'Bulk upload', 'Add or update sites, EB connections, systems and tasks from one Excel file.'],
      ['#settings', 'Settings', 'The rules behind the nightly checks and ticket deadlines.'],
      ['#users', 'Users', 'Who can sign in to Solar Fleet.'],
    ];
    main.replaceChildren(pageHead('Setup', 'Lists and settings you need now and then.'),
      h('div', { class: 'dash-grid' }, items.map(([href, t, d]) => h('a', { class: 'dash-card', href }, h('div', { class: 'dc-head' }, h('h3', null, t)), h('p', { class: 'setup-why' }, d)))));
  }

  /* ---------- energy: EB used against solar made, site by site ---------- */
  const energyState = { days: 30 };
  async function energy() {
    const t0 = today(), days = energyState.days, from = addDays(t0, -days), to = addDays(t0, -1);
    const [{ sites, conns }, systems, gen, imp] = await Promise.all([
      loadSites(),
      q(sb.from('solar_systems').select('id, site_id, type, tracking, inverter_spec, panel_spec, battery_spec').neq('tracking', 'Retired')),
      q(sb.from('solar_generation').select('system_id, date, kwh').gte('date', from).lte('date', to)),
      q(sb.from('solar_eb_import').select('eb_connection_id, date, daylight_kwh, day_kwh').gte('date', from).lte('date', to)),
    ]);
    const sysSite = Object.fromEntries(systems.map((x) => [x.id, x.site_id]));
    const lineSite = Object.fromEntries(conns.map((c) => [c.id, c.site_id]));
    const rows = sites.map((site) => {
      const g = gen.filter((r) => sysSite[r.system_id] === site.id && systems.find((x) => x.id === r.system_id && x.type !== 'Grid meter'));
      const e = imp.filter((r) => lineSite[r.eb_connection_id] === site.id);
      if (!g.length && !e.length) return null;
      const solar = d3.sum(g, (r) => +r.kwh || 0), eb = d3.sum(e, (r) => +r.day_kwh || 0);
      const ebDay = e.some((r) => r.daylight_kwh != null) ? d3.sum(e, (r) => +r.daylight_kwh || 0) : null;
      const sDays = new Set(g.map((r) => r.date)).size, eDays = new Set(e.map((r) => r.date)).size;
      const kwp = d3.sum(systems.filter((x) => x.site_id === site.id && x.type !== 'Grid meter'), (x) => cap(x).kwp || 0);
      return { site, solar, eb, ebDay, sDays, eDays, both: g.length && e.length,
        share: g.length && e.length && solar + eb ? solar / (solar + eb) : null,
        solarDay: sDays ? solar / sDays : null, ebPerDay: eDays ? eb / eDays : null, ebDayPerDay: eDays && ebDay != null ? ebDay / eDays : null,
        yieldKwp: sDays && kwp ? solar / sDays / kwp : null };
    }).filter(Boolean).sort((a, b) => (b.both - a.both) || a.site.name.localeCompare(b.site.name, undefined, { numeric: true }));
    const untracked = sites.length - rows.length;

    const bar = (r) => r.share == null ? null : h('div', { class: 'en-bar', title: `Solar ${Math.round(r.share * 100)}% · EB ${100 - Math.round(r.share * 100)}%` },
      h('div', { class: 'en-sun', style: `width:${r.share * 100}%` }), h('div', { class: 'en-grid' }));
    const card = (r) => h('a', { class: 'panel en-card', href: '#site/' + r.site.id, onclick: () => { siteState.key = 'site:' + r.site.id; siteState.tab = 'days'; } },
      h('div', { class: 'dg-head' }, h('h2', null, r.site.name), r.share != null ? h('span', { class: 'en-share' }, `${Math.round(r.share * 100)}% solar`) : h('span', { class: 'muted small' }, r.sDays ? 'EB not metered yet' : 'Solar not metered yet')),
      bar(r),
      h('div', { class: 'en-nums' },
        h('div', null, h('span', { class: 'en-v en-solar' }, r.solarDay == null ? '—' : n0(r.solarDay)), h('span', { class: 'en-l' }, 'solar units a day')),
        h('div', null, h('span', { class: 'en-v' }, r.ebPerDay == null ? '—' : n0(r.ebPerDay)), h('span', { class: 'en-l' }, 'EB units a day')),
        h('div', null, h('span', { class: 'en-v' + (r.ebDayPerDay != null && r.solarDay != null && r.ebDayPerDay > 0.25 * r.solarDay ? ' warn' : '') }, r.ebDayPerDay == null ? '—' : n0(r.ebDayPerDay)), h('span', { class: 'en-l' }, 'EB in daylight a day'))),
      h('p', { class: 'muted small en-foot' }, [r.sDays ? `${r.sDays} days of solar` : null, r.eDays ? `${r.eDays} days of EB` : null, r.yieldKwp != null ? `${d3.format('.1f')(r.yieldKwp)} units per kWp a day` : null].filter(Boolean).join(' · ')));
    const range = select('en-days', String(days), [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]);
    range.setAttribute('aria-label', 'Period');
    range.addEventListener('change', () => { energyState.days = +range.value; route(); });
    main.replaceChildren(...[
      pageHead('Energy', 'EB used against solar made at each site, from the daily readings. Click a site to see it day by day.'),
      h('div', { class: 'tk-bar' }, h('p', { class: 'legend small' }, h('span', null, h('i', { class: 'sw sun' }), 'Solar'), h('span', null, h('i', { class: 'sw gridfill' }), 'EB')), range),
      rows.length ? h('div', { class: 'en-grid-wrap' }, rows.map(card)) : h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No daily readings in this period yet.')),
      untracked ? h('p', { class: 'muted' }, `${plural(untracked, 'site')} not shown because no daily readings come in yet. `, h('a', { href: '#checklist', onclick: () => { checkState.step = 2; } }, 'See what is needed →')) : null].filter(Boolean));
    if (energyState.days !== days) return;
  }

  /* ---------- checklist: what is still missing at each site ---------- */
  const checkState = { view: 'missing', step: 1 };
  async function checklist() {
    const t0 = today();
    const [sitesData, systems, bills, genLast, impLast] = await Promise.all([
      loadSites(),
      q(sb.from('solar_systems').select('*').neq('tracking', 'Retired')),
      q(sb.from('solar_eb_bills').select('site_id, period_to, bill_date').neq('status', 'Rejected')),
      q(sb.from('solar_generation').select('system_id, date').gte('date', addDays(t0, -30))),
      q(sb.from('solar_eb_import').select('eb_connection_id, date').gte('date', addDays(t0, -30))),
    ]);
    const lastSys = d3.rollup(genLast, (v) => d3.max(v, (g) => g.date), (g) => g.system_id);
    const lastLine = d3.rollup(impLast, (v) => d3.max(v, (r) => r.date), (r) => r.eb_connection_id);
    const fresh = (d) => d && d >= addDays(t0, -3);
    const { sites, conns } = sitesData;
    const recent = addDays(t0, -183);
    const goodNo = (c) => c.service_no && c.service_no.replace(/\D/g, '').length >= 10;
    const hasSpec = (x) => (x.panel_spec || []).length && (x.inverter_spec || []).length;

    const rows = sites.map((site) => {
      const lines = conns.filter((c) => c.site_id === site.id && c.tracking !== 'Retired');
      const sys = systems.filter((x) => x.site_id === site.id && x.type !== 'Grid meter');
      const lastBill = d3.max(bills.filter((b) => b.site_id === site.id), (b) => b.period_to || b.bill_date);
      const badLine = lines.find((c) => !goodNo(c));
      const noSpec = sys.find((x) => !hasSpec(x));
      const checks = [
        { k: 'eb', ok: lines.length > 0 && !badLine, label: 'EB number',
          why: !lines.length ? 'No EB line entered' : badLine ? `Consumer number ${badLine.service_no || 'missing'} looks wrong` : '',
          fix: () => editConn(badLine || null, site) },
        { k: 'bill', ok: !!lastBill && lastBill >= recent, label: 'Recent bill', na: !lines.length,
          why: lastBill ? `Last bill ${fmtDay(lastBill)}` : 'No bills yet', fix: () => uploadBill(sitesData, site.id) },
        { k: 'solar', ok: !noSpec, na: !sys.length, label: sys.length ? 'Solar details' : 'No solar',
          why: noSpec ? `${noSpec.id}: panels or inverter not entered` : '',
          fix: () => { siteState.key = 'sys:' + noSpec.id; siteState.tab = 'details'; location.hash = 'system/' + noSpec.id; } },
        { k: 'spare', ok: !!site.extra_items, na: !sys.length, label: 'Spare items', why: 'Not checked yet', fix: () => spareDialog(site) },
      ];
      const needed = checks.filter((c) => !c.na);
      const done = needed.filter((c) => c.ok).length;
      // step 2: every EB line and every solar system sends a reading each day
      const status = (live, d) => (!live ? { cls: 'idle', text: 'Not tracked' } : fresh(d) ? { cls: 'ok', text: `Reporting · last ${fmtDay(d)}` }
        : { cls: 'bad', text: d ? `Stopped · last reading ${fmtDay(d)}` : 'Set up, but no readings yet' });
      const track = [
        ...sys.filter((x) => x.tracking !== 'Not installed').map((x) => { const d = lastSys.get(x.id); return { label: `Solar ${x.id}`, name: x.system || x.type || '', ok: fresh(d), st: status(x.tracking === 'Live', d),
          via: x.tracking === 'Live' ? x.tracked_via : null, note: x.tracking_note, table: 'solar_systems', key: x.id, sysId: x.id,
          why: x.tracking !== 'Live' ? 'No logger fitted yet' : d ? `Last reading ${fmtDay(d)}` : 'No readings yet', fix: () => editSystem(x) }; }),
        ...lines.map((c) => { const d = lastLine.get(c.id); return { label: `EB ${c.code}`, name: c.service_no ? 'consumer no. ' + c.service_no : '', ok: fresh(d), st: status(c.tracking === 'Live', d),
          via: c.tracking === 'Live' ? c.tracked_via : null, note: c.tracking_note, table: 'solar_eb_connections', key: c.id,
          why: c.tracking !== 'Live' ? 'No meter fitted yet' : d ? `Last reading ${fmtDay(d)}` : 'No readings yet', fix: () => editConn(c, site) }; })];
      const tracked = track.length > 0 && track.every((x) => x.ok);
      return { site, checks, needed, done, complete: done === needed.length, track, tracked };
    });

    const step = checkState.step;
    const isDone = (r) => (step === 1 ? r.complete : r.tracked);
    const nDone = rows.filter(isDone).length;
    const count = (k) => { const r = rows.map((x) => x.checks.find((c) => c.k === k)).filter((c) => !c.na); return `${r.filter((c) => c.ok).length} of ${r.length}`; };
    const lineAll = conns.filter((c) => c.tracking !== 'Retired'), sysAll = systems.filter((x) => x.type !== 'Grid meter');
    const allTrack = rows.flatMap((r) => r.track);
    const progress = step === 2 ? h('section', { class: 'panel ck-progress' },
      h('div', { class: 'ck-big' }, h('span', { class: 'tile-v' }, `${nDone} of ${rows.length}`), h('span', { class: 'tile-s' }, 'sites send EB and solar readings every day')),
      h('div', { class: 'ck-bar' }, h('div', { style: `width:${rows.length ? (nDone / rows.length) * 100 : 0}%` })),
      h('div', { class: 'ck-counts' },
        h('span', null, h('strong', null, `${allTrack.filter((x) => x.ok && x.label.startsWith('EB')).length} of ${allTrack.filter((x) => x.label.startsWith('EB')).length}`), ' EB lines reporting'),
        h('span', null, h('strong', null, `${allTrack.filter((x) => x.ok && x.label.startsWith('Solar')).length} of ${allTrack.filter((x) => x.label.startsWith('Solar')).length}`), ' solar systems reporting')),
      h('p', { class: 'muted small ck-next' }, 'Tracked means a reading arrived in the last 3 days. "Stopped" means a logger is set up but readings have stopped coming.'))
    : h('section', { class: 'panel ck-progress' },
      h('div', { class: 'ck-big' }, h('span', { class: 'tile-v' }, `${nDone} of ${rows.length}`), h('span', { class: 'tile-s' }, 'sites have everything filled in')),
      h('div', { class: 'ck-bar' }, h('div', { style: `width:${rows.length ? (nDone / rows.length) * 100 : 0}%` })),
      h('div', { class: 'ck-counts' },
        h('span', null, h('strong', null, count('eb')), ' EB numbers'), h('span', null, h('strong', null, count('bill')), ' recent bills'),
        h('span', null, h('strong', null, count('solar')), ' solar details'), h('span', null, h('strong', null, count('spare')), ' spare items checked')),
      h('p', { class: 'muted small ck-next' }, `Step 2, daily tracking: ${lineAll.filter((c) => fresh(lastLine.get(c.id))).length} of ${lineAll.length} EB lines and ${sysAll.filter((x) => fresh(lastSys.get(x.id))).length} of ${sysAll.length} solar systems send readings every day.`));

    const pill = (c) => c.na ? null : c.ok
      ? h('span', { class: 'ck-pill ok', title: c.why || null }, '✓ ', c.label)
      : canWrite() ? h('button', { class: 'ck-pill miss', type: 'button', title: c.why, onclick: c.fix }, c.label) : h('span', { class: 'ck-pill miss', title: c.why }, c.label);
    const body = h('div');
    const draw = () => {
      const shown = rows.filter((r) => step === 1 ? (checkState.view === 'all' || (checkState.view === 'done' ? isDone(r) : !isDone(r)))
        : r.track.some((x) => checkState.view === 'all' || (checkState.view === 'done' ? x.ok : !x.ok)));
      const typeOrder = ['Hostel', 'School', 'Office', 'Residence', 'Shop', 'Construction site'];
      const types = [...new Set(shown.map((r) => r.site.site_type || 'Other'))].sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99));
      body.replaceChildren(shown.length ? h('div', { class: 'ck-groups' }, types.map((t) => {
        const list = shown.filter((r) => (r.site.site_type || 'Other') === t).sort((a, b) => (isDone(a) - isDone(b)) || a.site.name.localeCompare(b.site.name, undefined, { numeric: true }));
        return h('section', { class: 'panel dg' }, h('div', { class: 'dg-head' }, h('h2', null, t === 'Other' ? 'Not grouped yet' : t + (/s$/.test(t) ? '' : 's')), h('span', { class: 'muted' }, String(list.length))),
          h('ul', { class: 'plain dg-list' }, list.map((r) => h('li', { class: 'ck-row' },
            h('a', { class: 'ck-name', href: '#site/' + r.site.id }, h('span', { class: 'dot ' + (isDone(r) ? 'ok' : 'warn') }), r.site.name),
            step === 2 ? h('ul', { class: 'plain ck-items' }, r.track.filter((x) => checkState.view === 'all' || (checkState.view === 'done' ? x.ok : !x.ok)).map((x) => h('li', { class: 'ck-item' },
              h('div', { class: 'ck-item-main' },
                h('span', { class: 'ck-item-name' }, h('strong', null, x.label), x.name ? h('span', { class: 'muted' }, ' · ' + x.name) : null),
                h('span', { class: 'ck-st ' + x.st.cls }, x.st.text + (x.via ? ` · via ${x.via}` : ''))),
              !x.ok ? h('div', { class: 'ck-why' }, x.note ? h('span', null, h('span', { class: 'muted' }, 'Why: '), x.note) : h('span', { class: 'muted' }, 'Reason not noted yet'),
                canWrite() ? h('span', { class: 'ck-acts' },
                  h('button', { class: 'link', onclick: () => whyDialog(x, r.site) }, x.note ? 'Change reason' : 'Add reason'),
                  h('button', { class: 'link', onclick: () => newTask(sites, r.site.id, route, x.sysId, `Set up daily tracking: ${x.label}${x.name ? ' (' + x.name + ')' : ''}`) }, 'Make a task'),
                  h('button', { class: 'link', onclick: x.fix }, 'Logger details')) : null) : null)))
            : h('span', { class: 'ck-pills' }, r.checks.map(pill),
              r.checks.find((c) => c.k === 'solar').na ? h('span', { class: 'ck-pill na' }, 'No solar') : null)))));
      })) : h('section', { class: 'panel' }, h('p', { class: 'empty' }, checkState.view === 'done' ? 'No site is complete yet.' : step === 2 ? 'Every site sends readings every day.' : 'Every site has everything filled in.')));
      segs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === checkState.view)));
    };
    const stepTabs = h('div', { class: 'segs page-tabs ck-steps' }, [[1, 'Step 1 · Site facts'], [2, 'Step 2 · Daily tracking']].map(([k, l]) =>
      h('button', { class: 'seg', type: 'button', 'aria-pressed': String(step === k), onclick: () => { checkState.step = k; route(); } }, l)));
    const segs = h('div', { class: 'segs page-tabs' }, (step === 2
      ? [['missing', `Not tracked · ${allTrack.filter((x) => !x.ok).length}`], ['done', `Tracked · ${allTrack.filter((x) => x.ok).length}`], ['all', 'All']]
      : [['missing', `Still missing · ${rows.filter((r) => !isDone(r)).length}`], ['done', `Complete · ${nDone}`], ['all', 'All']]).map(([v, l]) =>
      h('button', { class: 'seg', type: 'button', 'data-v': v, onclick: () => { checkState.view = v; draw(); } }, l)));
    draw();
    main.replaceChildren(
      pageHead('Checklist', step === 2 ? 'Every solar system and EB line that does not send daily readings yet, with the reason. Note why, then make a task to fix it.' : 'What is still missing at each site. Click an amber item to fill it in. To add a bill, you can also send the PDF or a photo to Claude.'),
      stepTabs, progress, segs, body);
  }

  // why an EB line or system is not tracked daily yet
  function whyDialog(x, site) {
    const box = h('textarea', { id: 'why-note', placeholder: 'For example: no logger fitted yet; inverter has no WiFi; waiting for the electrician; app login not known' }, x.note || '');
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      await q(sb.from(x.table).update({ tracking_note: box.value.trim() || null }).eq('id', x.key));
      closeDialog(); toast('Reason saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, `Why is ${x.label} not tracked? · ${site.name}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('Reason and what is being done', box, 'wide')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  }

  // remove a site that is no longer ours: only when it holds no bills or readings, and only after typing its name
  async function deleteSite(site) {
    const [sys, lines] = await Promise.all([
      q(sb.from('solar_systems').select('id').eq('site_id', site.id)),
      q(sb.from('solar_eb_connections').select('id').eq('site_id', site.id)),
    ]);
    const sysIds = sys.map((x) => x.id), lineIds = lines.map((c) => c.id);
    const [bills, gen, imp] = await Promise.all([
      q(sb.from('solar_eb_bills').select('id').eq('site_id', site.id).limit(1)),
      sysIds.length ? q(sb.from('solar_generation').select('date').in('system_id', sysIds).limit(1)) : [],
      lineIds.length ? q(sb.from('solar_eb_import').select('date').in('eb_connection_id', lineIds).limit(1)) : [],
    ]);
    if (bills.length || gen.length || imp.length) {
      openDialog(h('div', { class: 'dlg' }, h('div', { class: 'dlg-head' }, h('h2', null, 'This site can\'t be deleted'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Close')),
        h('p', null, `${site.name} has ${[bills.length ? 'bills' : null, gen.length || imp.length ? 'daily readings' : null].filter(Boolean).join(' and ')} saved. Deleting it would lose that history. Ask Claude if you still want it removed.`)));
      return;
    }
    const typed = input('del-name', '', { placeholder: site.name, autocomplete: 'off' });
    const go = h('button', { class: 'btn danger', type: 'submit', disabled: true }, 'Delete for good');
    typed.addEventListener('input', () => { go.disabled = typed.value.trim().toLowerCase() !== site.name.trim().toLowerCase(); });
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true;
      const orTickets = [`site_id.eq.${site.id}`, ...(sysIds.length ? [`system_id.in.(${sysIds.map((x) => '"' + x + '"').join(',')})`] : [])].join(',');
      await q(sb.from('solar_tickets').delete().or(orTickets));
      if (sysIds.length) await q(sb.from('solar_systems').delete().in('id', sysIds));
      if (lineIds.length) await q(sb.from('solar_eb_connections').delete().in('id', lineIds));
      await q(sb.from('solar_sites').delete().eq('id', site.id));
      closeDialog(); toast(site.name + ' deleted'); refreshCounts(); location.hash = 'overview';
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'Delete ' + site.name + '?'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('p', null, `This removes the site, its ${plural(lineIds.length, 'EB line')}, ${plural(sysIds.length, 'solar system')} and their tickets. It cannot be undone.`),
      h('div', { class: 'form-grid' }, field('Type the site name to confirm', typed, 'wide')),
      h('div', { class: 'actions' }, go)));
  }

  // spare equipment kept at a site; "nothing spare" also counts as checked
  function spareDialog(site) {
    const extra = h('textarea', { id: 'sp-extra', placeholder: 'For example: 68 panels of 325 W, one 5 kW inverter, 4 batteries in storage' }, site.extra_items && site.extra_items !== 'None' ? site.extra_items : '');
    const save = async (val) => { await q(sb.from('solar_sites').update({ extra_items: val }).eq('id', site.id)); closeDialog(); toast('Saved'); route(); };
    openDialog(h('form', { class: 'dlg', onsubmit: (e) => { e.preventDefault(); if (!extra.value.trim()) { extra.focus(); return; } save(extra.value.trim()); } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'Spare items · ' + site.name), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('p', { class: 'muted' }, 'Panels, inverters, batteries or other solar equipment kept at this site and not in use.'),
      h('div', { class: 'form-grid' }, field('What is spare here', extra, 'wide')),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => save('None') }, 'Nothing spare here'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  }

  /* ---------- dashboard: every site at a glance ---------- */
  const dashState = { q: '', type: '', show: '' };
  const siteState = { days: 30, tab: 'summary', key: '' };
  const billState = { view: 'week' };
  const istDate = (ts) => (ts ? new Date(Date.parse(ts) + 19800000).toISOString().slice(0, 10) : null);
  const isFault = (x) => x.tracking === 'Live' && x.attention && !['OK', 'Open item'].includes(x.attention);
  const rupees = (v) => (v == null || v === '' ? '—' : '₹' + Math.round(+v).toLocaleString('en-IN'));
  const billUnits = (b) => (b ? +(b.billed_kwh ?? b.import_kwh) : null);
  const monthOf = (b) => d3.utcFormat('%b %y')(new Date((b.period_to || b.bill_date || b.uploaded_at).slice(0, 10) + 'T00:00:00Z'));
  // payment state of a bill: paid, overdue, soon (due within a week), unpaid, or none (rejected)
  const payState = (b) => (b.status === 'Rejected' ? 'none' : b.paid ? 'paid' : b.due_date && b.due_date < today() ? 'overdue' : b.due_date && b.due_date <= addDays(today(), 7) ? 'soon' : 'unpaid');
  const isUnpaid = (b) => ['overdue', 'soon', 'unpaid'].includes(payState(b));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function overview() {
    const t0 = today();
    const [{ sites, conns }, systems, gen, open, billsAll, lines, impRecent] = await Promise.all([
      loadSites(),
      q(sb.from('solar_system_status').select('*').order('sort')),
      q(sb.from('solar_generation').select('date, system_id, kwh, note').gte('date', addDays(t0, -16)).order('date')),
      q(sb.from('solar_tickets').select('*').neq('status', 'Closed')),
      q(sb.from('solar_eb_bills').select('*').order('period_to', { ascending: false, nullsFirst: false })),
      q(sb.from('solar_eb_connections').select('id, tracking')),
      q(sb.from('solar_eb_import').select('eb_connection_id, date').gte('date', addDays(t0, -3))),
    ]);
    const lastDay = d3.max(gen, (g) => g.date) || addDays(t0, -1);

    const cards = sites.map((site) => {
      const sys = systems.filter((x) => x.site_id === site.id && x.tracking !== 'Retired' && x.type !== 'Grid meter');
      const live = sys.filter((x) => x.tracking === 'Live');
      const ids = new Set(live.map((x) => x.id));
      const mine = gen.filter((g) => ids.has(g.system_id));
      const byDay = d3.rollups(mine, (v) => ({ kwh: d3.sum(v, (g) => +g.kwh || 0), note: (v.find((g) => g.note) || {}).note }), (g) => g.date)
        .map(([date, o]) => ({ date, ...o }));
      const siteLast = d3.max(mine, (g) => g.date);
      const made = siteLast ? d3.sum(mine.filter((g) => g.date === siteLast), (g) => +g.kwh || 0) : null;
      const exp = d3.sum(live, (x) => +x.expected_kwh || 0) || null;
      const faults = live.filter(isFault);
      const tix = open.filter((t) => t.site_id === site.id);
      const overdue = tix.filter((t) => t.due && t.due < t0 && t.type !== 'Setup');
      const issues = tix.filter((t) => t.type !== 'Task' && t.type !== 'Setup');
      const tasks = tix.filter((t) => t.type === 'Task');
      const bills = billsAll.filter((b) => b.site_id === site.id);
      const waiting = bills.filter((b) => b.status === 'Submitted');
      const unpaid = bills.filter(isUnpaid).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
      const billLate = unpaid.find((b) => payState(b) === 'overdue'), billSoon = unpaid.find((b) => payState(b) === 'soon');
      const kw = d3.sum(sys, (x) => cap(x).inv);
      let level, label, why;
      if (faults.length) { level = 'bad'; label = 'Fault'; why = faults.map((x) => `${x.system || x.id}: ${x.attention}`).join('; '); }
      else if (overdue.length) { level = 'bad'; label = 'Overdue'; why = `${overdue[0].reason}, due ${fmtDay(overdue[0].due)}${overdue.length > 1 ? ` (+${overdue.length - 1} more)` : ''}`; }
      else if (billLate) { level = 'bad'; label = 'Bill overdue'; why = `${monthOf(billLate)} bill of ${rupees(billLate.amount)} was due ${fmtDay(billLate.due_date)} and is not marked paid`; }
      else if (issues.length) { level = 'warn'; label = 'Open issue'; why = issues[0].reason + (issues.length > 1 ? ` (+${issues.length - 1} more)` : ''); }
      else if (billSoon) { level = 'warn'; label = 'Bill due'; why = `${monthOf(billSoon)} bill of ${rupees(billSoon.amount)} is due ${fmtDay(billSoon.due_date)}`; }
      else if (waiting.length) { level = 'warn'; label = 'Bill to approve'; why = `${monthOf(waiting[0])} bill, ${rupees(waiting[0].amount)}`; }
      else if (tasks.length) { level = 'warn'; label = 'Task open'; why = `${tasks[0].reason}${tasks[0].due ? ', due ' + fmtDay(tasks[0].due) : ''}`; }
      else if (live.length) { level = 'ok'; label = 'OK'; why = 'Working normally'; }
      else { level = 'idle'; label = sys.length ? 'Not tracked' : 'No solar'; why = sys.length ? 'Solar here is not sending readings yet' : 'EB connection only'; }
      return { site, sys, live, byDay, siteLast, made, exp, faults, overdue, issues, tasks, bills, waiting, unpaid, kw, level, label, why };
    });

    // the dashboard: four headline tiles, then every site as one short line grouped by type
    const short = { Fault: 'Fault', Overdue: 'Overdue', 'Bill overdue': 'Bill overdue', 'Open issue': 'Issue open', 'Bill due': 'Bill due', 'Bill to approve': 'Bill to approve', 'Task open': 'Task open', OK: 'Working', 'Not tracked': 'Not tracked', 'No solar': 'No solar' };
    const rank = { bad: 0, warn: 1, ok: 2, idle: 3 };
    const list = h('div', { class: 'dg-groups' });
    const draw = () => {
      const shown = cards.filter((c) => dashState.show !== 'attention' || c.level === 'bad' || c.level === 'warn');
      const typeOrder = ['Hostel', 'School', 'Office', 'Residence', 'Shop', 'Construction site'];
      const types = [...new Set(shown.map((c) => c.site.site_type || 'Other'))]
        .sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99) || a.localeCompare(b));
      list.replaceChildren(...(types.length ? types.map((t) => {
        const rows = shown.filter((c) => (c.site.site_type || 'Other') === t)
          .sort((a, b) => rank[a.level] - rank[b.level] || a.site.name.localeCompare(b.site.name, undefined, { numeric: true }));
        const nBadT = rows.filter((c) => c.level === 'bad').length, nWarnT = rows.filter((c) => c.level === 'warn').length;
        return h('section', { class: 'panel dg' },
          h('div', { class: 'dg-head' }, h('h2', null, t === 'Other' ? 'Not grouped yet' : t + (rows.length === 1 || /s$/.test(t) ? '' : 's')),
            h('span', { class: 'muted' }, String(rows.length)),
            nBadT ? h('span', { class: 'dg-count bad' }, `${nBadT} need${nBadT === 1 ? 's' : ''} attention`) : nWarnT ? h('span', { class: 'dg-count warn' }, `${nWarnT} with something open`) : null),
          h('ul', { class: 'plain dg-list' }, rows.map((c) => h('li', null,
            h('a', { class: 'dg-row ' + c.level, href: '#site/' + c.site.id, title: c.why },
              h('span', { class: 'dot ' + c.level }), h('span', { class: 'dg-name' }, c.site.name),
              h('span', { class: 'dg-state ' + c.level }, short[c.label] || c.label), h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›'))))));
      }) : [h('p', { class: 'empty' }, 'Nothing needs attention.')]));
      showAll.setAttribute('aria-pressed', String(dashState.show !== 'attention'));
      showAtt.setAttribute('aria-pressed', String(dashState.show === 'attention'));
    };

    // headline tiles, each a door into the detail
    const tracked = systems.filter((x) => x.tracking === 'Live' && x.type !== 'Grid meter');
    const allSys = systems.filter((x) => x.tracking !== 'Retired' && x.type !== 'Grid meter');
    const fresh = tracked.filter((x) => gen.some((g) => g.system_id === x.id && g.date === lastDay));
    const made = d3.sum(gen.filter((g) => g.date === lastDay && fresh.some((x) => x.id === g.system_id)), (g) => +g.kwh || 0);
    const exp = d3.sum(fresh, (x) => +x.expected_kwh || 0);
    const overdueAll = open.filter((t) => t.due && t.due < t0 && t.type !== 'Setup').length;
    const openAll = open.filter((t) => t.type !== 'Setup').length;
    const waitingBills = billsAll.filter((b) => b.status === 'Submitted');
    const toPay = billsAll.filter(isUnpaid);
    const nBad = cards.filter((c) => c.level === 'bad').length, nWarn = cards.filter((c) => c.level === 'warn').length;
    const tile = (cls, label, big, sub, attrs) => h(attrs.href ? 'a' : 'button', { class: 'tile ' + (cls || ''), type: attrs.href ? null : 'button', ...attrs },
      h('span', { class: 'tile-l' }, label), h('span', { class: 'tile-v' }, big), h('span', { class: 'tile-s' }, sub));
    const tiles = h('div', { class: 'tiles' },
      tile(nBad ? 'bad' : nWarn ? 'warn' : 'ok', 'Sites', nBad ? String(nBad) : nWarn ? String(nWarn) : 'All OK',
        nBad ? `need${nBad === 1 ? 's' : ''} attention${nWarn ? ` · ${nWarn} more with something open` : ''}` : nWarn ? 'with something open' : `${cards.length} sites`,
        { onclick: () => { dashState.show = 'attention'; draw(); list.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }),
      tile(overdueAll ? 'bad' : '', 'Tickets and tasks', String(openAll), overdueAll ? `open · ${overdueAll} overdue` : 'open', { href: '#tickets' }),
      tile(toPay.some((b) => payState(b) === 'overdue') ? 'bad' : waitingBills.length || toPay.length ? 'warn' : '', 'EB bills',
        waitingBills.length ? String(waitingBills.length) : toPay.length ? rupees(d3.sum(toPay, (b) => +b.amount || 0)) : 'Clear',
        waitingBills.length ? (isOwner() ? 'to approve' : 'awaiting approval') + (toPay.length ? ` · ${toPay.length} to pay` : '') : toPay.length ? `to pay · ${plural(toPay.length, 'bill')}` : 'nothing to approve or pay', { href: '#bills' }),
      tile(exp && made < 0.75 * exp ? 'warn' : '', 'Solar', fresh.length ? n0(made) + ' units' : '—',
        fresh.length ? `on ${fmtDay(lastDay)}${exp ? ' · expected ' + n0(exp) : ''} · ${tracked.length} of ${allSys.length} tracked` : `${tracked.length} of ${allSys.length} systems tracked`, { href: '#systems' }));

    // getting set up comes first: step 1 facts, step 2 daily tracking
    const recentBill = addDays(t0, -183);
    const liveConns = conns.filter((c) => c.tracking !== 'Retired');
    const sysReal = systems.filter((x) => x.tracking !== 'Retired' && x.type !== 'Grid meter');
    const step1 = sites.map((site) => {
      const ls = liveConns.filter((c) => c.site_id === site.id), sy = sysReal.filter((x) => x.site_id === site.id);
      const lb = d3.max(billsAll.filter((b) => b.site_id === site.id && b.status !== 'Rejected'), (b) => b.period_to || b.bill_date);
      const miss = [
        !ls.length || ls.some((c) => !c.service_no || c.service_no.replace(/\D/g, '').length < 10) ? 'EB number' : null,
        ls.length && !(lb && lb >= recentBill) ? 'recent bill' : null,
        sy.some((x) => !(x.panel_spec || []).length || !(x.inverter_spec || []).length) ? 'solar details' : null,
        sy.length && !site.extra_items ? 'spare items' : null].filter(Boolean);
      return { site, miss };
    });
    const s1done = step1.filter((r) => !r.miss.length).length;
    const freshSys = new Set(gen.filter((g) => g.date >= addDays(t0, -3)).map((g) => g.system_id));
    const freshLine = new Set(impRecent.map((r) => r.eb_connection_id));
    const trackItems = [...sysReal.filter((x) => x.tracking !== 'Not installed').map((x) => ({ ok: freshSys.has(x.id), site: x.site_id })),
      ...liveConns.map((c) => ({ ok: freshLine.has(c.id), site: c.site_id }))];
    const s2done = trackItems.filter((x) => x.ok).length;
    const siteName = Object.fromEntries(sites.map((x) => [x.id, x.name]));
    const s2sites = [...new Set(trackItems.filter((x) => !x.ok).map((x) => x.site))];
    const stepCard = (n, title, done, total, unit, nextText, step) => h('a', { class: 'panel step-card', href: '#checklist', onclick: () => { checkState.step = step; checkState.view = 'missing'; } },
      h('div', { class: 'step-top' }, h('span', { class: 'step-n' }, 'Step ' + n), h('h2', null, title), h('span', { class: 'step-go' }, done === total ? 'Done ✓' : 'Continue →')),
      h('div', { class: 'step-fig' }, h('span', { class: 'tile-v' }, `${done} of ${total}`), h('span', { class: 'tile-s' }, unit)),
      h('div', { class: 'ck-bar' }, h('div', { style: `width:${total ? (done / total) * 100 : 0}%` })),
      nextText ? h('p', { class: 'muted small step-next' }, nextText) : null);
    const s1left = step1.filter((r) => r.miss.length);
    const setupPanel = h('section', { class: 'step-cards' },
      stepCard(1, 'Site facts', s1done, sites.length, 'sites fully filled in',
        s1left.length ? `Next: ${s1left.slice(0, 3).map((r) => `${r.site.name} (${r.miss.join(', ')})`).join(' · ')}${s1left.length > 3 ? ` · and ${s1left.length - 3} more` : ''}` : 'Every site has its EB number, bills, solar details and spare items.', 1),
      stepCard(2, 'Daily tracking', s2done, trackItems.length, 'solar systems and EB lines sending readings',
        s2sites.length ? `Still to set up at ${plural(s2sites.length, 'site')}: ${s2sites.slice(0, 4).map((k) => siteName[k] || k).join(', ')}${s2sites.length > 4 ? ` and ${s2sites.length - 4} more` : ''}` : 'Every system and EB line sends readings every day.', 2));

    const showAll = h('button', { class: 'seg', type: 'button', onclick: () => { dashState.show = ''; draw(); } }, 'All sites');
    const showAtt = h('button', { class: 'seg', type: 'button', onclick: () => { dashState.show = 'attention'; draw(); } }, 'Needs attention');
    draw();
    main.replaceChildren(
      pageHead('Dashboard', 'Finish setting up first: get every site\'s facts in, then get every system and EB line sending daily readings.', canWrite() ? h('button', { class: 'btn', onclick: () => newTask(sites) }, 'New task') : null),
      setupPanel,
      h('h2', { class: 'dash-sub' }, 'Day to day'),
      tiles,
      h('div', { class: 'sec-head dg-bar' }, h('h2', null, 'Sites'), h('div', { class: 'segs', role: 'group', 'aria-label': 'Show' }, showAll, showAtt)),
      list);
  }

  /* ---------- one site, day by day ---------- */
  // one system on its own page: its readings, its complaints and tasks, nothing from the rest of the site
  async function systemPage(sysId) {
    const rows = await q(sb.from('solar_system_status').select('id, site_id').eq('id', decodeURIComponent(sysId || '')));
    if (!rows.length) { main.replaceChildren(h('p', { class: 'empty' }, 'That system was not found. ', h('a', { href: '#systems' }, 'Back to all systems'))); return; }
    return sitePage(rows[0].site_id, rows[0].id);
  }

  // raise a complaint against one system
  function raiseComplaint(x, site, onDone) {
    const reason = input('rc-reason', '', { required: true, placeholder: 'For example: inverter showing error, battery not charging, MCB tripped' });
    const details = h('textarea', { id: 'rc-details' });
    const due = input('rc-due', addDays(today(), 3), { type: 'date', required: true });
    const assigned = input('rc-assigned', '');
    const files = input('rc-files', '', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const row = await q(sb.from('solar_tickets').insert({ type: 'Manual', system_id: x.id, site_id: x.site_id, site: `${site.name} · ${x.system || x.id}`, reason: reason.value.trim(),
        details: details.value.trim() || null, due: due.value, assigned_to: assigned.value.trim() || null }).select().single());
      try { await uploadTicketPhotos(row.id, files.files); } catch (err) { toast('Complaint raised, but the photos did not upload', true); }
      closeDialog(); toast('Complaint ' + tno(row.id) + ' raised'); refreshCounts(); onDone ? onDone() : route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, `Raise a complaint · ${x.id} ${x.system || ''}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('p', { class: 'muted' }, site.name),
      h('div', { class: 'form-grid' }, field('What is wrong', reason, 'wide'), field('Details', details, 'wide'), field('Fix by', due), field('Assigned to', assigned), field('Photos (optional)', files, 'wide')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Raise complaint'))));
  }

  async function sitePage(id, only) {
    const t0 = today();
    const { sites, conns } = await loadSites();
    const site = sites.find((x) => x.id === id);
    if (!site) { main.replaceChildren(h('p', { class: 'empty' }, 'That site was not found. ', h('a', { href: '#overview' }, 'Back to all sites'))); return; }
    const lines = conns.filter((c) => c.site_id === id && c.tracking !== 'Retired');
    const allSystems = await q(sb.from('solar_system_status').select('*').eq('site_id', id).order('sort'));
    const systems = only ? allSystems.filter((x) => x.id === only) : allSystems.filter((x) => x.tracking !== 'Retired');
    const one = only ? systems[0] : null;
    const solar = only ? systems : systems.filter((x) => x.type !== 'Grid meter');
    const sysIds = systems.map((x) => x.id), connIds = only ? [] : lines.map((c) => c.id);
    const from = addDays(t0, -(siteState.days - 1));
    const none = Promise.resolve([]);
    const [gen, imp, tixAll, logAll, billsAll, planned] = await Promise.all([
      sysIds.length ? q(sb.from('solar_generation').select('*').in('system_id', sysIds).gte('date', from).order('date')) : none,
      connIds.length ? q(sb.from('solar_eb_import').select('*').in('eb_connection_id', connIds).gte('date', from).order('date')) : none,
      q(sb.from('solar_tickets').select('*').eq('site_id', id).order('id', { ascending: false })),
      q(sb.from('solar_site_log').select('*').eq('site_id', id).order('created_at', { ascending: false })),
      q(sb.from('solar_eb_bills').select('*').eq('site_id', id).order('period_to', { ascending: false, nullsFirst: false })),
      sysIds.length ? q(sb.from('solar_planned_work').select('*').in('system_id', sysIds)) : none,
    ]);
    // on a system's own page: only its complaints and tasks, and no site-wide notes or EB bills
    const tix = only ? tixAll.filter((t) => t.system_id === only) : tixAll;
    const log = only ? [] : logAll, bills = only ? [] : billsAll;
    const notes = tix.length ? await q(sb.from('solar_ticket_notes').select('*').in('ticket_id', tix.map((t) => t.id)).order('created_at')) : [];
    const sysName = Object.fromEntries(systems.map((x) => [x.id, x.system || x.id]));
    const live = solar.filter((x) => x.tracking === 'Live');
    const exp = d3.sum(live, (x) => +x.expected_kwh || 0) || null;

    // everything that happened, keyed by day
    const events = new Map();
    const add = (date, ev) => { if (!date || date < from || date > t0) return; if (!events.has(date)) events.set(date, []); events.get(date).push(ev); };
    tix.forEach((t) => {
      const task = t.type === 'Task';
      add(t.raised, { kind: task ? 'Task added' : t.auto ? 'Ticket raised' : 'Ticket added', cls: task ? 'task' : 'bad', text: t.reason, href: '#ticket/' + t.id });
      if (t.status === 'Closed') add(t.closed_on, { kind: task ? 'Task done' : 'Ticket closed', cls: 'ok', text: t.reason + (t.resolution ? ': ' + t.resolution : ''), href: '#ticket/' + t.id });
    });
    notes.forEach((n) => add(istDate(n.created_at), { kind: 'Ticket note', cls: 'note', text: `${n.body}${n.author_name ? ' (' + n.author_name + ')' : ''}`, href: '#ticket/' + n.ticket_id }));
    log.forEach((n) => add(n.date, { kind: 'Note', cls: 'note', text: n.body, by: n.author_name, log: n }));
    bills.forEach((b) => {
      add(b.period_to || b.bill_date, { kind: 'EB bill', cls: 'bill', text: `${n0(billUnits(b))} units · ${rupees(b.amount)}${b.status === 'Submitted' ? ' · awaiting approval' : ''}${isUnpaid(b) && b.due_date ? ' · due ' + fmtDay(b.due_date) : ''}`, bill: b });
      if (b.paid && b.paid_on) add(b.paid_on, { kind: 'Bill paid', cls: 'ok', text: `${monthOf(b)} bill · ${rupees(b.amount)}`, bill: b });
      if (b.reviewed_at && b.status !== 'Submitted') add(istDate(b.reviewed_at), { kind: 'Bill ' + b.status.toLowerCase(), cls: b.status === 'Approved' ? 'ok' : 'bad', text: `${monthOf(b)} bill${b.review_note ? ': ' + b.review_note : ''}`, bill: b });
    });
    planned.forEach((p) => add(p.from_date < from ? from : p.from_date, { kind: 'Planned work', cls: 'task', text: `${sysName[p.system_id] || ''}: ${p.reason || ''} (${fmtDay(p.from_date)} to ${fmtDay(p.to_date)})` }));
    gen.filter((g) => g.note).forEach((g) => add(g.date, { kind: 'Reading note', cls: 'note', text: `${sysName[g.system_id]}: ${g.note}` }));

    const solarGen = gen.filter((g) => solar.some((x) => x.id === g.system_id));
    const genByDay = d3.rollup(solarGen, (v) => ({ total: d3.sum(v, (g) => +g.kwh || 0), parts: v }), (g) => g.date);
    const impByDay = d3.rollup(imp, (v) => ({ daylight: d3.sum(v, (r) => +r.daylight_kwh || 0), day: d3.sum(v, (r) => +r.day_kwh || 0) }), (r) => r.date);
    const hasMeter = solarGen.length || imp.length;
    const daysDesc = d3.range(siteState.days).map((k) => addDays(t0, -k));
    const shown = hasMeter ? daysDesc.filter((d) => d < t0 || genByDay.has(d) || impByDay.has(d) || events.has(d)) : daysDesc.filter((d) => events.has(d));

    const evNode = (e) => {
      const body = e.bill ? h('button', { class: 'link', onclick: () => billDetail(e.bill) }, e.text) : e.href ? h('a', { href: e.href }, e.text) : h('span', null, e.text);
      let rm = null;
      if (e.log && (isOwner() || e.log.author === state.user.id)) {
        rm = h('button', { class: 'link small ev-rm' }, 'Remove');
        rm.addEventListener('click', async () => {
          if (rm.dataset.sure !== '1') { rm.dataset.sure = '1'; rm.textContent = 'Click again to remove'; return; }
          await q(sb.from('solar_site_log').delete().eq('id', e.log.id)); toast('Note removed'); route();
        });
      }
      return h('div', { class: 'ev ' + e.cls }, h('span', { class: 'ev-kind' }, e.kind), h('span', null, body, e.by ? h('span', { class: 'muted' }, ` · ${e.by}`) : null, rm));
    };
    const showSolar = live.length > 0 || solarGen.length > 0;
    const dayRow = (d) => {
      const g = genByDay.get(d), im = impByDay.get(d), ev = events.get(d) || [];
      const missing = live.length && !g && d < t0;
      const share = g && exp ? g.total / exp : null;
      const low = g && (g.total === 0 || (share != null && share < 0.6));
      const wk = new Date(d + 'T00:00:00Z').getUTCDay();
      return h('tr', { id: 'day-' + d, class: (wk === 0 ? 'sunday ' : '') + (low || missing ? 'day-bad' : '') },
        h('td', { class: 'nw day-date' }, h('strong', null, d3.utcFormat('%-d %b')(new Date(d + 'T00:00:00Z'))), h('span', { class: 'muted' }, ' ' + d3.utcFormat('%a')(new Date(d + 'T00:00:00Z')))),
        showSolar ? h('td', { class: 'n nw' }, g ? [h('span', { class: low ? 'due-bad' : null }, n1(g.total)),
          g.parts.length > 1 || solar.length > 1 ? h('div', { class: 'muted small' }, g.parts.map((p) => `${sysName[p.system_id]} ${n1(p.kwh)}`).join(' · ')) : null]
          : missing ? h('span', { class: 'due-bad small' }, 'No reading') : h('span', { class: 'muted' }, '—')) : null,
        showSolar ? h('td', { class: 'day-bar' }, share != null ? [h('div', { class: 'mini-bar' }, h('div', { class: low ? 'low' : '', style: `width:${Math.min(100, share * 100 / 1.3)}%` }), h('i', { style: 'left:76.9%' })),
          h('span', { class: 'small ' + (low ? 'due-bad' : 'muted') }, Math.round(share * 100) + '%')] : null) : null,
        imp.length ? h('td', { class: 'n nw' }, im ? [n1(im.daylight), h('div', { class: 'muted small' }, `${n1(im.day)} all day`)] : h('span', { class: 'muted' }, '—')) : null,
        h('td', { class: 'day-events' }, ev.length ? ev.map(evNode) : null));
    };
    const dayTable = shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'day-table' },
      h('thead', null, h('tr', null, h('th', null, 'Day'), showSolar ? h('th', { class: 'n' }, 'Solar units') : null, showSolar ? h('th', { class: 'day-bar' }, 'Against expected') : null,
        imp.length ? h('th', { class: 'n' }, 'EB in daylight') : null, h('th', null, 'What happened'))),
      h('tbody', null, shown.map(dayRow))))
      : only ? h('p', { class: 'empty' }, `Nothing recorded for this system in the last ${siteState.days} days. Readings appear once it is tracked; complaints and tasks appear as they are raised.`)
      : h('p', { class: 'empty' }, `Nothing recorded here in the last ${siteState.days} days. Meter readings appear once this site's solar or EB line is tracked; notes, tickets, tasks and bills appear as they are added.`);

    // header figures
    const lastGen = d3.max(solarGen, (g) => g.date);
    const last7 = lastGen ? d3.range(7).map((k) => genByDay.get(addDays(lastGen, -k))).filter(Boolean) : [];
    const avg7 = last7.length ? d3.mean(last7, (x) => x.total) : null;
    const openTix = tix.filter((t) => t.status !== 'Closed');
    const fig = (v, l, cls) => h('div', { class: 'fig' + (cls ? ' ' + cls : '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const figs = h('section', { class: 'panel dash-strip' },
      live.length ? fig(lastGen ? n1(genByDay.get(lastGen).total) : '—', lastGen ? `units on ${fmtDay(lastGen)}` : 'no readings in this period', lastGen && exp && genByDay.get(lastGen).total < 0.6 * exp ? 'low' : null) : null,
      only ? fig(one.tracking === 'Live' ? (isFault(one) ? 'Fault' : 'Working') : one.tracking === 'Pending' ? 'Not tracked' : one.tracking, one.tracking === 'Live' ? (isFault(one) ? one.attention : `tracked via ${one.tracked_via}`) : one.tracking === 'Pending' ? 'no readings are coming in yet' : 'not in service', isFault(one) ? 'low' : null)
      : fig(bills[0] ? rupees(bills[0].amount) : '—', bills[0] ? `${monthOf(bills[0])} bill · ${n0(billUnits(bills[0]))} units${isUnpaid(bills[0]) ? (bills[0].due_date ? ' · due ' + fmtDay(bills[0].due_date) : '') + ', not paid' : ''}` : 'no bills entered', bills[0] && payState(bills[0]) === 'overdue' ? 'low' : null),
      fig(String(openTix.filter((t) => t.type !== 'Setup').length), only ? 'open complaints and tasks' : 'open tickets and tasks', openTix.some((t) => t.due && t.due < t0 && t.type !== 'Setup') ? 'low' : null));

    const chart = h('div', { class: 'chart' });
    const billBars = bills.filter((b) => b.status !== 'Rejected' && billUnits(b) != null).slice(0, 12).reverse();
    const billBox = h('div', { class: 'chart' });
    if (billBars.length) requestAnimationFrame(() => billChart(billBox, billBars));
    const billSection = !only && billBars.length ? h('section', { class: 'panel' },
      h('div', { class: 'sec-head' }, h('h2', null, 'EB units used, bill by bill'), h('p', { class: 'muted small' }, billBars.length > 1 ? `Last ${billBars.length} bills · click a bar to open the bill` : 'Click the bar to open the bill')),
      billBox) : null;
    // say plainly what is missing, so an empty chart is never a puzzle
    const gaps = only ? [] : [
      solar.length && !solarGen.length ? (live.length ? `No solar readings have arrived in the last ${siteState.days} days.` : 'Solar here is not tracked yet, so there is no daily solar chart.') : null,
      lines.length && !imp.length ? 'Daily EB use will show here once this line has a smart meter. Until then, EB use is shown bill by bill below.' : null].filter(Boolean);
    if (hasMeter) requestAnimationFrame(() => siteChart(chart, daysDesc.slice().reverse(), genByDay, impByDay, exp, events));

    // side panels
    const c = capSum(solar);
    const kv = (k, v) => (v ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', null, v)) : null);
    const details = h('section', { class: 'panel side-panel' }, h('div', { class: 'sec-head' }, h('h3', null, 'Details'), canWrite() ? h('button', { class: 'btn small', onclick: () => editSite(site, sites) }, 'Edit site') : null,
      isOwner() ? h('button', { class: 'btn small danger-ghost', onclick: () => deleteSite(site) }, 'Delete site') : null),
      kv('Type', site.site_type), kv('Address', site.address),
      ...lines.flatMap((l) => [kv(lines.length > 1 ? `Consumer no. (${l.label})` : 'Consumer no.', l.service_no), kv('Sanctioned', l.sanctioned_kw != null ? l.sanctioned_kw + ' kW' : null), kv('Tariff', l.tariff),
        kv('In charge', l.incharge), l.contact_phone ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Mobile'), h('a', { href: 'tel:' + l.contact_phone }, l.contact_phone)) : null]),
      kv('Solar', capText(c)), kv('Extra items', site.extra_items),
      site.notes ? h('p', { class: 'ctx-notes' }, site.notes) : null,
      ...lines.filter((l) => l.notes).map((l) => h('p', { class: 'ctx-notes' }, l.notes)));
    const openPanel = h('section', { class: 'panel side-panel' }, h('h3', null, 'Open now'),
      openTix.length ? h('ul', { class: 'plain queue' }, openTix.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'))).map((t) => h('li', null,
        h('a', { href: '#ticket/' + t.id }, t.reason),
        canWrite() ? h('button', { class: 'btn small q-close', onclick: () => closeTicketDialog(t, route) }, t.type === 'Task' ? 'Done' : 'Resolve') : null,
        h('div', { class: 'small ' + (t.due && t.due < t0 && t.type !== 'Setup' ? 'due-bad' : 'muted') },
          `${!only && t.system_id && solar.length > 1 ? (sysName[t.system_id] || t.system_id) + ' · ' : ''}${t.type === 'Task' ? 'Task' : t.type === 'Setup' ? 'Question' : 'Complaint'}${t.due ? ' · due ' + fmtDay(t.due) + (t.due < t0 && t.type !== 'Setup' ? ', overdue' : '') : ''}${t.assigned_to ? ' · ' + t.assigned_to : ''}`))))
        : h('p', { class: 'muted' }, 'Nothing open.'));
    const billPanel = h('section', { class: 'panel side-panel' }, h('h3', null, 'Last bills'),
      bills.length ? h('div', { class: 'bill-row' }, bills.slice(0, 3).map((b) => h('button', { class: 'bill-mini' + (b.status === 'Submitted' ? ' wait' : b.status === 'Rejected' ? ' bad' : ''), onclick: () => billDetail(b) },
        h('span', { class: 'd' }, monthOf(b) + (isUnpaid(b) ? ' · unpaid' : '')), h('span', { class: 'u' }, n0(billUnits(b)) + ' u'), h('span', { class: 'a' }, rupees(b.amount)))))
        : h('p', { class: 'muted' }, 'No bills entered.'),
      bills.length > 3 ? h('a', { class: 'small', href: '#bills' }, `All ${bills.length} bills`) : null);
    const closedTix = tix.filter((t) => t.status === 'Closed').sort((a, b) => String(b.closed_on || '').localeCompare(String(a.closed_on || '')));
    const historyPanel = only ? h('section', { class: 'panel side-panel' }, h('h3', null, 'Resolved'),
      closedTix.length ? h('ul', { class: 'plain queue' }, closedTix.slice(0, 12).map((t) => h('li', null, h('a', { href: '#ticket/' + t.id }, t.reason),
        h('div', { class: 'small muted' }, `${t.closed_on ? fmtDay(t.closed_on) : ''}${t.resolution ? ' · ' + t.resolution : ''}`))))
        : h('p', { class: 'muted' }, 'Nothing resolved yet.')) : null;
    const onePanel = one ? h('section', { class: 'panel side-panel' }, h('div', { class: 'sec-head' }, h('h3', null, 'This system'), canWrite() ? h('button', { class: 'btn small', onclick: () => editSystem(one) }, 'Edit system') : null),
      kv('ID', one.id), kv('Type', one.type), kv('Inverter', specLine(one.inverter_spec, 'inverter')), kv('Panels', specLine(one.panel_spec, 'panel')), kv('Battery', specLine(one.battery_spec, 'battery')),
      kv('Tracked via', one.tracked_via), kv('Expected', one.expected_kwh != null ? n0(one.expected_kwh) + ' units a day' : null),
      one.notes ? h('p', { class: 'ctx-notes' }, one.notes) : null) : null;
    // each system on the site as its own card, so each can be opened, complained about and resolved separately
    const sysCards = !only && solar.length ? h('section', null, h('h2', null, solar.length > 1 ? `Systems here · ${solar.length}` : 'System here'),
      h('div', { class: 'dash-grid' }, solar.map((x) => {
        const mine = openTix.filter((t) => t.system_id === x.id && t.type !== 'Setup');
        const lastX = d3.max(gen.filter((g) => g.system_id === x.id), (g) => g.date);
        const lv = x.tracking !== 'Live' ? 'idle' : isFault(x) || mine.some((t) => t.due && t.due < t0) ? 'bad' : mine.length ? 'warn' : 'ok';
        return h('div', { class: 'dash-card sys-card ' + lv },
          h('a', { class: 'dc-head', href: '#system/' + x.id }, h('h3', null, `${x.id} · ${x.system || x.type || ''}`),
            h('span', { class: 'chip ' + (lv === 'bad' ? 'bad' : lv === 'ok' ? 'ok' : '') }, x.tracking !== 'Live' ? (x.tracking === 'Pending' ? 'Not tracked' : x.tracking) : isFault(x) ? 'Fault' : 'Working')),
          h('p', { class: 'setup-why' }, x.tracking === 'Live' ? (isFault(x) ? x.attention : lastX ? `${n1(gen.find((g) => g.system_id === x.id && g.date === lastX).kwh)} units on ${fmtDay(lastX)} · expected ${n0(x.expected_kwh)}` : 'No readings in this period') : [x.type, capText(capSum([x]))].filter(Boolean).join(' · ')),
          h('p', { class: 'small ' + (mine.some((t) => t.due && t.due < t0) ? 'due-bad' : 'muted') }, mine.length ? `${mine.length} open` : 'Nothing open'),
          h('div', { class: 'actions sys-actions' }, h('a', { class: 'btn small', href: '#system/' + x.id }, 'Open'),
            canWrite() ? h('button', { class: 'btn small', onclick: () => raiseComplaint(x, site, route) }, 'Raise a complaint') : null));
      }))) : null;
    const sysPanel = h('section', { class: 'panel side-panel' }, h('h3', null, 'Solar systems'),
      solar.length ? solar.map((x) => h('div', { class: 'ctx-sys' },
        h('a', { href: '#system/' + x.id }, h('strong', null, `${x.id} ${x.system || ''}`)),
        h('div', { class: 'small ' + (isFault(x) ? 'due-bad' : 'muted') }, x.tracking === 'Live' ? (isFault(x) ? x.attention : `Tracked via ${x.tracked_via} · expected ${n0(x.expected_kwh)} a day`) : x.tracking === 'Pending' ? 'Not tracked yet' : x.tracking),
        x.notes ? h('div', { class: 'small muted' }, x.notes) : null)) : h('p', { class: 'muted' }, 'No solar system at this site.'));

    const addNote = () => {
      const date = input('sn-date', t0, { type: 'date', max: t0, required: true });
      const body = h('textarea', { id: 'sn-body', required: true, placeholder: 'What happened? For example: electrician visited, inverter reset, panels cleaned, EB power cut 2 to 5 pm.' });
      openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
        e.preventDefault();
        if (!body.value.trim()) { body.focus(); return; }
        await q(sb.from('solar_site_log').insert({ site_id: id, date: date.value, body: body.value.trim(), author: state.user.id, author_name: state.me.name }));
        closeDialog(); toast('Note added'); route();
      } },
        h('div', { class: 'dlg-head' }, h('h2', null, 'Add a note · ' + site.name), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
        h('div', { class: 'form-grid' }, field('Day', date), field('Note', body, 'wide')),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add note'))));
    };
    const range = select('sp-range', String(siteState.days), [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']]);
    range.addEventListener('change', () => { siteState.days = +range.value; route(); });
    const fault = live.filter(isFault);

    // one page, a few tabs: the summary first, everything else one click away
    const key = only ? 'sys:' + only : 'site:' + id;
    if (siteState.key !== key) { siteState.key = key; siteState.tab = 'summary'; }
    const tabs = [['summary', 'Summary'], ['days', 'Day by day'], ...(only ? [] : [['bills', 'Bills']]), ['details', 'Details']];
    const setTab = (k) => { siteState.tab = k; route(); };
    const tabBar = h('div', { class: 'segs page-tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { class: 'seg', type: 'button', role: 'tab', 'aria-selected': String(siteState.tab === k), 'aria-pressed': String(siteState.tab === k), onclick: () => setTab(k) }, l)));
    const legend = hasMeter ? h('p', { class: 'legend small' },
      solarGen.length ? h('span', null, h('i', { class: 'sw sun' }), 'Solar units') : null, solarGen.length ? h('span', null, h('i', { class: 'sw bad' }), 'Under 60% of expected') : null,
      exp ? h('span', null, h('i', { class: 'sw dash' }), 'Expected') : null, imp.length ? h('span', null, h('i', { class: 'sw grid' }), 'EB in daylight') : null) : null;
    const more = (label, k) => h('button', { class: 'link more-link', onclick: () => setTab(k) }, label + ' →');

    // systems here as one line each
    const sysLines = !only && solar.length ? h('section', { class: 'panel dg' }, h('div', { class: 'dg-head' }, h('h2', null, solar.length > 1 ? 'Systems here' : 'System here'), h('span', { class: 'muted' }, String(solar.length))),
      h('ul', { class: 'plain dg-list' }, solar.map((x) => {
        const mine = openTix.filter((t) => t.system_id === x.id && t.type !== 'Setup');
        const lv = x.tracking !== 'Live' ? 'idle' : isFault(x) || mine.some((t) => t.due && t.due < t0) ? 'bad' : mine.length ? 'warn' : 'ok';
        const word = x.tracking !== 'Live' ? (x.tracking === 'Pending' ? 'Not tracked' : x.tracking) : isFault(x) ? 'Fault' : mine.length ? `${mine.length} open` : 'Working';
        return h('li', null, h('a', { class: 'dg-row', href: '#system/' + x.id }, h('span', { class: 'dot ' + lv }),
          h('span', { class: 'dg-name' }, `${x.id} · ${x.system || x.type || ''}`), h('span', { class: 'dg-state ' + lv }, word), h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')));
      }))) : null;
    const openShort = h('section', { class: 'panel dg' }, h('div', { class: 'dg-head' }, h('h2', null, 'Open'), h('span', { class: 'muted' }, String(openTix.length))),
      openTix.length ? h('ul', { class: 'plain dg-list' }, openTix.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'))).slice(0, 5).map((t) => h('li', null,
        h('a', { class: 'dg-row', href: '#ticket/' + t.id }, h('span', { class: 'dot ' + (t.due && t.due < t0 && t.type !== 'Setup' ? 'bad' : 'warn') }), h('span', { class: 'dg-name' }, t.reason),
          h('span', { class: 'dg-state' + (t.due && t.due < t0 && t.type !== 'Setup' ? ' bad' : '') }, t.due ? (t.due < t0 ? 'overdue' : 'due ' + fmtDay(t.due)) : ''), h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')))))
        : h('p', { class: 'muted' }, 'Nothing open.'),
      openTix.length > 5 ? h('a', { class: 'more-link', href: '#tickets' }, `All ${openTix.length} on the Tickets page →`) : null);

    let content;
    if (siteState.tab === 'days') {
      content = [h('section', { class: 'panel' }, h('div', { class: 'sec-head' }, h('h2', null, 'Day by day'), field('Period', range)), legend, hasMeter ? chart : null,
        gaps.length ? h('p', { class: 'muted small gap-note' }, gaps.join(' ')) : null, dayTable)];
    } else if (siteState.tab === 'bills') {
      content = [bills.length ? billSection : null,
        h('section', { class: 'panel' }, h('div', { class: 'sec-head' }, h('h2', null, 'Bills'), canWrite() ? h('button', { class: 'btn', onclick: async () => uploadBill(await loadSites(), id) }, 'Upload a bill') : null),
          bills.length ? h('ul', { class: 'plain dg-list' }, bills.map((b) => h('li', null, h('button', { class: 'dg-row link-row', onclick: () => billDetail(b) },
            h('span', { class: 'dot ' + (payState(b) === 'overdue' ? 'bad' : b.status === 'Submitted' || isUnpaid(b) ? 'warn' : 'ok') }),
            h('span', { class: 'dg-name' }, `${monthOf(b)} · ${n0(billUnits(b))} units · ${rupees(b.amount)}`, b.due_date ? h('span', { class: 'dg-sub' }, `due ${fmtDate(b.due_date)}${b.paid && b.paid_on ? ' · paid ' + fmtDate(b.paid_on) : ''}`) : null),
            h('span', { class: 'dg-state' + (payState(b) === 'overdue' ? ' bad' : '') }, b.status === 'Submitted' ? 'to approve' : b.status === 'Rejected' ? 'rejected' : isUnpaid(b) ? (payState(b) === 'overdue' ? 'overdue' : 'not paid') : 'paid'),
            h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')))))
            : h('p', { class: 'muted' }, 'No bills entered yet.'))];
    } else if (siteState.tab === 'details') {
      content = only ? [onePanel, historyPanel] : [details, sysPanel];
    } else {
      content = [fault.length ? h('p', { class: 'site-alert' }, fault.map((x) => `${x.system || x.id}: ${x.attention}`).join(' · ')) : null,
        figs,
        h('div', { class: 'sum-cols' }, sysLines || (only ? null : null), openShort),
        hasMeter ? h('section', { class: 'panel' }, h('div', { class: 'sec-head' }, h('h2', null, `Last ${siteState.days} days`), more('Day by day', 'days')), legend, chart)
          : h('section', { class: 'panel' }, h('p', { class: 'muted' }, gaps.length ? gaps.join(' ') : 'No daily readings yet.'), more('Day by day', 'days'))];
    }

    main.replaceChildren(...[
      only ? h('a', { class: 'back', href: '#site/' + id }, '← ' + site.name) : h('a', { class: 'back', href: '#overview' }, '← Dashboard'),
      only ? pageHead(`${one.id} · ${one.system || one.type || 'System'}`, site.name,
        canWrite() ? h('button', { class: 'btn primary', onclick: () => raiseComplaint(one, site, route) }, 'Raise a complaint') : null,
        canWrite() ? h('button', { class: 'btn', onclick: () => newTask(sites, id, route, one.id) }, 'New task') : null)
      : pageHead(site.name, site.site_type || '',
        canWrite() ? h('button', { class: 'btn primary', onclick: addNote }, 'Add a note') : null,
        canWrite() ? h('button', { class: 'btn', onclick: () => newTask(sites, id, route) }, 'New task') : null),
      tabBar, ...content].filter(Boolean));
  }

  // EB units on each bill, oldest to newest; click a bar to open the bill
  function billChart(box, list) {
    const W = Math.max(320, box.clientWidth || 640), H = 200, m = { t: 22, r: 8, b: 34, l: 44 };
    const x = d3.scaleBand(list.map((b) => b.id), [m.l, W - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, (d3.max(list, billUnits) || 1) * 1.1], [H - m.b, m.t]).nice(4);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'EB units on each bill');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', 'var(--line)');
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', m.l - 6).attr('y', y).attr('dy', '.32em').attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--muted)').text((d) => d3.format(',')(d));
    const bw = Math.min(x.bandwidth(), 56), off = (x.bandwidth() - bw) / 2;
    svg.append('g').selectAll('rect').data(list).join('rect').attr('x', (b) => x(b.id) + off).attr('width', bw).attr('rx', 2)
      .attr('y', (b) => Math.min(y(billUnits(b) || 0), y(0) - 2)).attr('height', (b) => Math.max(2, y(0) - y(billUnits(b) || 0)))
      .attr('fill', 'var(--grid)').style('cursor', 'pointer').on('click', (ev, b) => billDetail(b))
      .append('title').text((b) => `${monthOf(b)} · ${n0(billUnits(b))} units · ${rupees(b.amount)}`);
    if (x.bandwidth() > 34) svg.append('g').selectAll('text').data(list).join('text').attr('x', (b) => x(b.id) + x.bandwidth() / 2).attr('y', (b) => y(billUnits(b) || 0) - 5)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--ink)').text((b) => n0(billUnits(b)));
    svg.append('g').selectAll('text').data(list).join('text').attr('x', (b) => x(b.id) + x.bandwidth() / 2).attr('y', H - m.b + 14)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--muted)').text(monthOf);
    if (x.bandwidth() > 44) svg.append('g').selectAll('text').data(list).join('text').attr('x', (b) => x(b.id) + x.bandwidth() / 2).attr('y', H - m.b + 27)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--muted)').text((b) => rupees(b.amount));
    box.replaceChildren(svg.node());
  }

  function siteChart(box, days, genByDay, impByDay, exp, events) {
    const W = Math.max(320, box.clientWidth || 640), H = 190, m = { t: 10, r: 8, b: 34, l: 38 };
    const maxGen = d3.max(days, (d) => (genByDay.get(d) ? genByDay.get(d).total : 0)) || 0;
    const maxImp = d3.max(days, (d) => (impByDay.get(d) ? impByDay.get(d).daylight : 0)) || 0;
    const x = d3.scaleBand(days, [m.l, W - m.r]).padding(days.length > 120 ? 0.05 : 0.22);
    const y = d3.scaleLinear([0, Math.max(maxGen, maxImp, exp || 0, 1) * 1.08], [H - m.b, m.t]).nice(4);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Units each day');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', 'var(--line)');
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', m.l - 6).attr('y', y).attr('dy', '.32em').attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--muted)').text((d) => d3.format('~s')(d));
    const low = (d) => { const t = genByDay.get(d).total; return t === 0 || (exp && t < 0.6 * exp); };
    svg.append('g').selectAll('rect').data(days.filter((d) => genByDay.has(d))).join('rect')
      .attr('x', (d) => x(d)).attr('width', x.bandwidth()).attr('rx', Math.min(2, x.bandwidth() / 3))
      .attr('y', (d) => Math.min(y(genByDay.get(d).total), y(0) - 2)).attr('height', (d) => Math.max(2, y(0) - y(genByDay.get(d).total)))
      .attr('fill', (d) => (low(d) ? 'var(--bad)' : 'var(--sun)'));
    if (exp) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(exp)).attr('y2', y(exp)).attr('stroke', 'var(--ink)').attr('stroke-dasharray', '4 3').attr('stroke-opacity', 0.7);
    const impDays = days.filter((d) => impByDay.has(d));
    if (impDays.length) {
      const line = d3.line().x((d) => x(d) + x.bandwidth() / 2).y((d) => y(impByDay.get(d).daylight));
      svg.append('path').attr('d', line(impDays)).attr('fill', 'none').attr('stroke', 'var(--grid)').attr('stroke-width', 2);
      if (impDays.length < 100) svg.append('g').selectAll('circle').data(impDays).join('circle').attr('cx', (d) => x(d) + x.bandwidth() / 2).attr('cy', (d) => y(impByDay.get(d).daylight)).attr('r', 2.5).attr('fill', 'var(--grid)');
    }
    svg.append('g').selectAll('circle').data(days.filter((d) => events.has(d))).join('circle')
      .attr('cx', (d) => x(d) + x.bandwidth() / 2).attr('cy', H - m.b + 8).attr('r', Math.max(2, Math.min(3.5, x.bandwidth() / 2))).attr('fill', 'var(--ink)');
    const step = Math.ceil(days.length / Math.max(2, Math.floor((W - m.l) / 70)));
    svg.append('g').selectAll('text').data(days.filter((d, i) => (days.length - 1 - i) % step === 0)).join('text').attr('x', (d) => x(d) + x.bandwidth() / 2).attr('y', H - 6)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--muted)').text(fmtDay);
    const tip = h('div', { class: 'tip', hidden: true });
    svg.append('g').selectAll('rect').data(days).join('rect').attr('x', (d) => x(d) - x.step() * x.paddingInner() / 2).attr('width', x.step()).attr('y', m.t).attr('height', H - m.t - 4).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('mousemove', (ev, d) => {
        const g = genByDay.get(d), im = impByDay.get(d), e = events.get(d) || [];
        tip.replaceChildren(h('div', { class: 'muted' }, d3.utcFormat('%a %-d %b')(new Date(d + 'T00:00:00Z'))),
          g ? h('div', null, `${n1(g.total)} solar units${exp ? ' · ' + Math.round((g.total / exp) * 100) + '% of expected' : ''}`) : null,
          im ? h('div', null, `${n1(im.daylight)} EB units in daylight`) : null,
          !g && !im ? h('div', null, 'No reading') : null,
          ...e.slice(0, 3).map((v) => h('div', { class: 'muted' }, `${v.kind}: ${v.text.slice(0, 60)}`)));
        tip.hidden = false;
        const b = box.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(0, ev.clientX - b.left + 12), b.width - tip.offsetWidth) + 'px';
        tip.style.top = Math.max(0, ev.clientY - b.top - tip.offsetHeight - 8) + 'px';
      })
      .on('mouseleave', () => { tip.hidden = true; })
      .on('click', (ev, d) => {
        const row = document.getElementById('day-' + d);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
      });
    box.replaceChildren(svg.node(), tip);
  }

  function spark(rows, lastDay) {
    const days = d3.range(13, -1, -1).map((k) => addDays(lastDay || today(), -k));
    const by = new Map(rows.map((r) => [r.date, r]));
    const W = 280, H = 40;
    const max = d3.max(rows, (r) => +r.kwh) || 1;
    const x = d3.scaleBand(days, [0, W]).padding(0.25);
    const y = d3.scaleLinear([0, max], [H - 2, 2]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'none').attr('aria-hidden', 'true');
    svg.selectAll('rect').data(days).join('rect')
      .attr('x', (d) => x(d)).attr('width', x.bandwidth())
      .attr('y', (d) => (by.get(d) ? y(+by.get(d).kwh) : H - 2)).attr('height', (d) => (by.get(d) ? Math.max(2, H - 2 - y(+by.get(d).kwh)) : 2))
      .attr('rx', 1.5)
      .attr('fill', (d) => (!by.get(d) ? 'var(--line)' : +by.get(d).kwh === 0 ? 'var(--bad)' : 'var(--sun)'))
      .attr('fill-opacity', (d) => (by.get(d) && /^(Partial|Covers)/.test(by.get(d).note || '') ? 0.4 : 1));
    return svg.node();
  }

  /* ---------- tickets ---------- */
  let ticketTab = 'open';
  const ticketFilter = { site: '', mine: false };
  async function tickets() {
    const [all, systemsList, { sites }] = await Promise.all([
      q(sb.from('solar_tickets').select('*').order('id', { ascending: false })),
      q(sb.from('solar_systems').select('id, site, site_id, system').order('sort')),
      loadSites(),
    ]);
    const siteOf = Object.fromEntries(systemsList.map((x) => [x.id, x.site_id]));
    const siteName = Object.fromEntries(sites.map((x) => [x.id, x.name]));
    const sid = (t) => t.site_id || siteOf[t.system_id] || '';
    const t0 = today();
    const isOver = (t) => t.due && t.due < t0 && t.status !== 'Closed';
    const myName = (state.me.name || '').trim().toLowerCase();
    const passes = (t) => (!ticketFilter.site || sid(t) === ticketFilter.site)
      && (!ticketFilter.mine || (t.assigned_to || '').trim().toLowerCase() === myName);
    const kind = (t) => ({ Fault: 'Fault', 'Site issue': 'Issue', Manual: 'Complaint', Task: 'Task', Setup: 'Question' }[t.type] || t.type);
    const views = [
      ['open', 'Open', (t) => t.status !== 'Closed' && t.type !== 'Setup'],
      ['setup', 'Questions', (t) => t.status !== 'Closed' && t.type === 'Setup'],
      ['closed', 'Done', (t) => t.status === 'Closed'],
    ];
    if (ticketTab === 'tasks') ticketTab = 'open';
    const body = h('div', { class: 'tk-body' });
    const segs = h('div', { class: 'segs', role: 'group', 'aria-label': 'Show' });
    const closeTicket = (t) => closeTicketDialog(t, () => { Object.assign(t, { status: 'Closed', closed_on: t0 }); refreshCounts(); drawSegs(); draw(); });
    const open = (t) => { location.hash = 'ticket/' + t.id; };

    // one ticket, one line: what kind, what is wrong, when it is due, and a single Done
    const row = (t, withSite) => h('li', null, h('div', { class: 'tk-row' + (isOver(t) ? ' over' : ''), tabindex: 0, role: 'link',
        onclick: (e) => { if (!e.target.closest('button')) open(t); },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.target.closest('button')) open(t); } },
      h('span', { class: 'tk-kind k-' + kind(t).toLowerCase() }, kind(t)),
      h('span', { class: 'tk-what' }, h('span', { class: 'tk-reason' }, t.reason),
        h('span', { class: 'tk-sub' }, [withSite ? siteName[sid(t)] || t.site : null, t.system_id, t.assigned_to ? 'with ' + t.assigned_to : null, t.status === 'In progress' ? 'in progress' : null].filter(Boolean).join(' · '))),
      h('span', { class: 'tk-due' + (isOver(t) ? ' due-bad' : '') }, t.status === 'Closed' ? (t.closed_on ? fmtDay(t.closed_on) : '') : t.due ? (isOver(t) ? 'overdue · ' : 'due ') + fmtDay(t.due) : ''),
      canWrite() && t.status !== 'Closed' ? h('button', { class: 'btn small', onclick: () => closeTicket(t) }, 'Done') : null));

    function draw() {
      const [, , f] = views.find((x) => x[0] === ticketTab);
      const list = all.filter((t) => f(t) && passes(t));
      if (!list.length) { body.replaceChildren(h('p', { class: 'empty' }, ticketTab === 'closed' ? 'Nothing done yet.' : 'Nothing open.')); return; }
      if (ticketTab === 'closed') {
        list.sort((a, b) => String(b.closed_on || '').localeCompare(String(a.closed_on || '')) || b.id - a.id);
        body.replaceChildren(h('section', { class: 'panel dg' }, h('ul', { class: 'plain dg-list' }, list.slice(0, 60).map((t) => row(t, true)))),
          list.length > 60 ? h('p', { class: 'muted small' }, `Showing the latest 60 of ${list.length}.`) : null);
        return;
      }
      // grouped by site; sites with something overdue first
      const groups = d3.groups(list, sid).map(([k, ts]) => [k, ts.sort((a, b) => (isOver(b) - isOver(a)) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.id - b.id)]);
      groups.sort((a, b) => (b[1].some(isOver) - a[1].some(isOver)) || (siteName[a[0]] || 'zz').localeCompare(siteName[b[0]] || 'zz', undefined, { numeric: true }));
      body.replaceChildren(h('div', { class: 'dg-groups tk-groups' }, groups.map(([k, ts]) => {
        const nOver = ts.filter(isOver).length;
        return h('section', { class: 'panel dg' },
          h('div', { class: 'dg-head' }, k ? h('a', { class: 'tk-site', href: '#site/' + k }, h('h2', null, siteName[k] || k)) : h('h2', null, 'General'),
            h('span', { class: 'muted' }, String(ts.length)),
            nOver ? h('span', { class: 'dg-count bad' }, `${nOver} overdue`) : null),
          h('ul', { class: 'plain dg-list' }, ts.map((t) => row(t, false))));
      })));
    }
    function drawSegs() {
      segs.replaceChildren(...views.map(([k, l, f]) => {
        const n = all.filter((t) => f(t) && passes(t)).length;
        if (k === 'setup' && !n && ticketTab !== 'setup') return null;
        return h('button', { class: 'seg', type: 'button', 'aria-pressed': String(ticketTab === k), onclick: () => { ticketTab = k; drawSegs(); draw(); } },
          k === 'closed' ? l : `${l} · ${n}`);
      }).filter(Boolean));
    }
    const siteSel = select('tk-site', ticketFilter.site, [['', 'All sites'], ...sites.map((x) => [x.id, x.name])]);
    siteSel.setAttribute('aria-label', 'Site');
    siteSel.addEventListener('change', () => { ticketFilter.site = siteSel.value; drawSegs(); draw(); });
    const mine = h('button', { class: 'seg tk-mine', type: 'button', 'aria-pressed': String(ticketFilter.mine),
      onclick: () => { ticketFilter.mine = !ticketFilter.mine; mine.setAttribute('aria-pressed', String(ticketFilter.mine)); drawSegs(); draw(); } }, 'Mine');
    drawSegs(); draw();
    main.replaceChildren(
      pageHead('Tickets', 'Click a ticket to open it. Press Done when the work is finished.',
        canWrite() ? h('button', { class: 'btn', onclick: () => newTask(sites, ticketFilter.site, () => { ticketTab = 'open'; route(); }) }, 'New task') : null,
        canWrite() ? h('button', { class: 'btn primary', onclick: () => newTicket(systemsList) }, 'New complaint') : null),
      h('div', { class: 'tk-bar' }, segs, h('div', { class: 'tk-filters' }, siteSel, h('div', { class: 'segs' }, mine))),
      body,
      canWrite() ? h('p', { class: 'tk-foot' }, h('button', { class: 'link', onclick: async () => { await q(sb.rpc('solar_run_checks_now')); toast('Checks run'); route(); refreshCounts(); } }, 'Run the nightly checks now')) : null);
  }

  function closeTicketDialog(t, onDone) {
    const isTask = t.type === 'Task';
    const res = h('textarea', { id: 'cl-res', required: true, placeholder: isTask ? 'What was done' : 'What was found and what was done' }, t.resolution || '');
    const files = input('cl-files', '', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, isTask ? 'Mark done' : 'Close ticket');
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      if (!res.value.trim()) { res.focus(); return; }
      btn.disabled = true;
      try {
        await uploadTicketPhotos(t.id, files.files);
        await q(sb.from('solar_tickets').update({ status: 'Closed', resolution: res.value.trim() }).eq('id', t.id));
        t.resolution = res.value.trim();
        closeDialog(); toast(isTask ? 'Task done' : tno(t.id) + ' closed'); onDone && onDone();
      } catch (err) { toast(err.message || 'Could not close it', true); btn.disabled = false; }
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, `${isTask ? 'Finish' : 'Close'} ${tno(t.id)} · ${t.reason}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('p', { class: 'muted' }, t.site || t.system_id || ''),
      h('div', { class: 'form-grid' }, field(isTask ? 'What was done' : 'Resolution', res, 'wide'), field('Photos (optional)', files, 'wide')),
      h('div', { class: 'actions' }, btn)));
  }

  function newTask(sites, presetSite, onDone, presetSys, presetReason) {
    const site = select('ta-site', presetSite || '', [['', 'Choose a site'], ...sites.map((x) => [x.id, x.name])]);
    site.required = true;
    const reason = input('ta-reason', presetReason || '', { required: true, placeholder: 'For example: clean panels, fix earthing, replace battery cables' });
    const details = h('textarea', { id: 'ta-details' });
    const due = input('ta-due', addDays(today(), 7), { type: 'date', required: true });
    const assigned = input('ta-assigned', '');
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const st = sites.find((x) => x.id === site.value);
      await q(sb.from('solar_tickets').insert({ type: 'Task', site_id: site.value, system_id: presetSys && site.value === presetSite ? presetSys : null, site: st ? st.name + (presetSys && site.value === presetSite ? ' · ' + presetSys : '') : null, reason: reason.value.trim(),
        details: details.value.trim() || null, due: due.value, assigned_to: assigned.value.trim() || null }));
      closeDialog(); toast('Task added'); refreshCounts(); onDone ? onDone() : route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, presetSys ? 'New task · ' + presetSys : 'New task'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('Site', site, 'wide'), field('What needs doing', reason, 'wide'), field('Details', details, 'wide'), field('Due by', due), field('Assigned to', assigned)),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add task'))));
  }

  async function uploadTicketPhotos(ticketId, fileList) {
    for (const file of [...(fileList || [])]) {
      const path = `${ticketId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const up = await sb.storage.from('solar-tickets').upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      await q(sb.from('solar_ticket_photos').insert({ ticket_id: ticketId, path, file_name: file.name, uploaded_by: state.user.id, uploaded_by_name: state.me.name }));
    }
  }

  async function photoPanel(t, ro) {
    const rows = await q(sb.from('solar_ticket_photos').select('*').eq('ticket_id', t.id).order('created_at'));
    const urls = rows.length ? (await sb.storage.from('solar-tickets').createSignedUrls(rows.map((r) => r.path), 600)).data || [] : [];
    const gallery = h('div', { class: 'photos' }, rows.length ? rows.map((r, i) => {
      const url = urls[i] && urls[i].signedUrl;
      const isImg = /\.(jpe?g|png|webp|heic)$/i.test(r.path);
      return h('a', { class: 'photo', href: url || '#', target: '_blank', rel: 'noopener' },
        isImg && url ? h('img', { src: url, alt: r.file_name || 'Photo', loading: 'lazy' }) : h('span', null, r.file_name || 'File'),
        h('span', { class: 'muted' }, `${r.uploaded_by_name || ''} · ${d3.timeFormat('%-d %b')(new Date(r.created_at))}`));
    }) : h('p', { class: 'muted' }, 'No photos yet.'));
    const files = input('ph-files', '', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
    const add = ro ? null : h('form', { class: 'actions', onsubmit: async (e) => {
      e.preventDefault();
      if (!files.files.length) return;
      await uploadTicketPhotos(t.id, files.files); toast('Photos added'); route();
    } }, files, h('button', { class: 'btn', type: 'submit' }, 'Add photos'));
    return h('section', { class: 'panel' }, h('h3', null, 'Photos'), gallery, add);
  }

  function newTicket(systemsList) {
    const sys = select('nt-sys', '', [['', 'Not tied to a system'], ...systemsList.map((s) => [s.id, `${s.id} · ${s.site} ${s.system || ''}`])]);
    const reason = input('nt-reason', '', { required: true, placeholder: 'For example: MCB tripped at the terrace board' });
    const details = h('textarea', { id: 'nt-details' });
    const assigned = input('nt-assigned', '');
    const form = h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const s = systemsList.find((x) => x.id === sys.value);
      const row = await q(sb.from('solar_tickets').insert({ type: 'Manual', system_id: sys.value || null, site: s ? `${s.site}${s.system ? ' · ' + s.system : ''}` : null,
        reason: reason.value.trim(), details: details.value.trim() || null, assigned_to: assigned.value.trim() || null }).select().single());
      closeDialog(); toast('Complaint ' + tno(row.id) + ' raised'); location.hash = 'ticket/' + row.id; refreshCounts();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'New complaint'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('System', sys, 'wide'), field('What is wrong', reason, 'wide'), field('Details', details, 'wide'), field('Assigned to', assigned)),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Raise ticket')));
    openDialog(form);
  }

  async function ticket(id) {
    const [t, notes] = await Promise.all([
      q(sb.from('solar_tickets').select('*').eq('id', id).single()),
      q(sb.from('solar_ticket_notes').select('*').eq('ticket_id', id).order('created_at')),
    ]);
    const ro = !canWrite();
    const t0 = today();
    const kindWord = { Fault: 'Fault', 'Site issue': 'Issue', Manual: 'Complaint', Task: 'Task', Setup: 'Question' }[t.type] || t.type;
    const over = t.due && t.due < t0 && t.status !== 'Closed';
    const siteLink = t.site_id ? h('a', { href: '#site/' + t.site_id }, (t.site || '').split(' · ')[0] || t.site_id) : (t.site || null);

    // changing who and when sits behind one button
    const assigned = input('tk-assigned', t.assigned_to);
    const due = input('tk-due', t.due, { type: 'date' });
    const editForm = h('form', { class: 'panel', hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      await q(sb.from('solar_tickets').update({ assigned_to: assigned.value.trim() || null, due: due.value || null }).eq('id', id));
      toast('Saved'); refreshCounts(); route();
    } }, h('div', { class: 'form-grid' }, field('Assigned to', assigned), field('Due', due)),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'link', onclick: () => { editForm.hidden = true; } }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')));

    const facts = h('section', { class: 'panel tk-facts' },
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Status'), h('span', { class: 'chip ' + (t.status === 'Closed' ? 'ok' : t.status === 'In progress' ? 'amber' : 'bad') }, t.status === 'Closed' ? 'Done' : t.status)),
      t.status === 'Closed' ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Done on'), h('span', null, t.closed_on ? fmtDate(t.closed_on) : '—'))
        : h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Due'), h('span', { class: over ? 'due-bad' : null }, t.due ? fmtDate(t.due) + (over ? ' · overdue' : '') : 'No deadline')),
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Assigned to'), h('span', null, t.assigned_to || '—')),
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Raised'), h('span', null, fmtDate(t.raised) + (t.auto ? ' · by the nightly check' : ''))),
      t.details ? h('p', { class: 'ctx-notes' }, t.details) : null,
      t.status === 'Closed' && t.resolution ? h('p', { class: 'tk-res' }, h('strong', null, 'What was done: '), t.resolution) : null);

    const photos = await photoPanel(t, ro);
    const noteBox = h('textarea', { id: 'tk-note', placeholder: 'Add an update: a site visit, a call, a part ordered' });
    const noteList = notes.length ? h('div', { class: 'notes' }, notes.map((n) => h('div', { class: 'note' + (n.author ? '' : ' system') },
      h('div', { class: 'meta' }, `${n.author_name || 'System'} · ${d3.timeFormat('%-d %b, %H:%M')(new Date(n.created_at))}`), h('p', null, n.body)))) : null;
    const noteForm = ro ? null : h('form', { class: 'notes', onsubmit: async (e) => {
      e.preventDefault();
      if (!noteBox.value.trim()) return;
      await q(sb.from('solar_ticket_notes').insert({ ticket_id: +id, author: state.user.id, author_name: state.me.name, body: noteBox.value.trim() }));
      toast('Update added'); route();
    } }, noteBox, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, 'Add update')));

    main.replaceChildren(...[
      h('a', { class: 'back', href: '#tickets' }, '← Tickets'),
      pageHead(t.reason, h('span', null, kindWord, siteLink ? ' · ' : '', siteLink, t.system_id ? ' · ' : '', t.system_id ? h('a', { href: '#system/' + t.system_id }, t.system_id) : null, ` · ${tno(t.id)}`),
        !ro && t.status === 'Open' ? h('button', { class: 'btn', onclick: async () => { await q(sb.from('solar_tickets').update({ status: 'In progress', assigned_to: t.assigned_to || state.me.name }).eq('id', id)); toast('Started'); route(); } }, 'Start') : null,
        !ro && t.status !== 'Closed' ? h('button', { class: 'btn', onclick: () => { editForm.hidden = !editForm.hidden; } }, 'Change due or person') : null,
        !ro && t.status !== 'Closed' ? h('button', { class: 'btn primary', onclick: () => closeTicketDialog(t, () => { refreshCounts(); route(); }) }, t.type === 'Task' ? 'Mark done' : 'Resolve') : null,
        !ro && t.status === 'Closed' ? h('button', { class: 'btn', onclick: async () => { await q(sb.from('solar_tickets').update({ status: 'Open' }).eq('id', id)); toast('Reopened'); refreshCounts(); route(); } }, 'Reopen') : null),
      editForm, facts,
      h('section', { class: 'panel' }, h('h3', null, 'Updates'), noteList || (ro ? h('p', { class: 'muted' }, 'No updates yet.') : null), noteForm),
      photos].filter(Boolean));
  }

  /* ---------- EB bills ---------- */
  // A bill belongs to the month its period ends in (or its bill date when there is no period).
  const billMonth = (b) => (b.period_to || b.bill_date || b.uploaded_at || '').slice(0, 7);
  // typical bill timing for one EB line, worked out from its own past bills
  const addMonths = (d, n) => {
    const x = new Date(d + 'T00:00:00Z'), dd = x.getUTCDate();
    x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n);
    x.setUTCDate(Math.min(dd, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()));
    return x.toISOString().slice(0, 10);
  };
  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  const ord = (n) => n + ([, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');
  function billTiming(conn, all) {
    const dt = (b) => b.bill_date || b.period_to;
    const bs = all.filter((b) => b.eb_connection_id === conn.id && b.status !== 'Rejected' && dt(b)).sort((a, b) => dt(a).localeCompare(dt(b)));
    if (!bs.length) return { conn, last: null };
    const gaps = d3.pairs(bs).map(([a, b]) => dayDiff(dt(b), dt(a)) / 30.44).filter((m) => m > 0.5 && m < 3.5);
    const g = gaps.length ? d3.median(gaps) : null;
    const cycle = g == null ? 2 : g >= 1.5 ? 2 : 1;
    const offs = bs.filter((b) => b.due_date && b.bill_date).map((b) => dayDiff(b.due_date, b.bill_date)).filter((d) => d > 0 && d < 60);
    const offset = Math.round(offs.length ? d3.median(offs) : 20);
    const dueDays = bs.filter((b) => b.due_date).map((b) => +b.due_date.slice(8, 10));
    const dueDay = dueDays.length ? Math.round(d3.median(dueDays)) : null;
    const last = bs[bs.length - 1];
    // the latest bill is still open: that is what falls due next
    if (isUnpaid(last)) return { conn, last, cycle, guess: g == null, offset, dueDay, open: last, nextDue: last.due_date || addDays(dt(last), offset), missed: 0 };
    // otherwise the next bill is expected one cycle after the last; skip ahead past any that were never uploaded
    let nextBill = addMonths(dt(last), cycle), missed = 0;
    while (addDays(nextBill, offset) < addDays(today(), -10) && missed < 12) { nextBill = addMonths(nextBill, cycle); missed++; }
    return { conn, last, cycle, guess: g == null, offset, dueDay, open: null, nextBill, nextDue: addDays(nextBill, offset), missed };
  }
  const typicalText = (t) => (t.last ? `${t.guess ? 'Probably every 2 months' : t.cycle === 1 ? 'Every month' : 'Every 2 months'}${t.dueDay ? `, due around the ${ord(t.dueDay)}` : ''}` : 'No bills yet');
  const payFrom = (co) => (co ? co.name + (co.pay_account ? ' · ' + co.pay_account : '') : 'No company set');

  async function bills() {
    const [list, sitesData, companies] = await Promise.all([
      q(sb.from('solar_eb_bills').select('*').order('uploaded_at', { ascending: false })),
      loadSites(),
      q(sb.from('solar_companies').select('*').order('sort').order('name')),
    ]);
    const { sites, conns } = sitesData;
    const t0 = today(), wk = addDays(t0, 7);
    const coById = Object.fromEntries(companies.map((c) => [c.id, c]));
    const siteById = Object.fromEntries(sites.map((s) => [s.id, s]));
    const siteCo = (siteId) => coById[(siteById[siteId] || {}).company_id] || null;
    const liveConns = conns.filter((c) => c.tracking !== 'Retired' && siteById[c.site_id]);
    const multi = new Set(d3.rollups(liveConns, (v) => v.length, (c) => c.site_id).filter(([, n]) => n > 1).map(([k]) => k));
    const lineName = (c) => siteById[c.site_id].name + (multi.has(c.site_id) ? ' · ' + c.label : '');
    const timing = liveConns.map((c) => billTiming(c, list));

    const now = t0.slice(0, 7);
    const months = d3.range(11, -1, -1).map((k) => { const d = new Date(Date.parse(now + '-01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
    const mLabel = (m) => d3.utcFormat('%b %y')(new Date(m + '-01T00:00:00Z'));
    const waiting = list.filter((b) => b.status === 'Submitted');
    const unassigned = list.filter((b) => !b.eb_connection_id);
    const toPay = list.filter((b) => b.status === 'Approved' && isUnpaid(b)).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));

    // bill due: every line with a bill falling due in the next 7 days or already late, uploaded or not
    const due = timing.filter((t) => t.last && t.nextDue <= wk).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
    const dueIds = new Set(due.filter((t) => t.open).map((t) => t.open.id));
    // unpaid bills that are late or due this week but not the newest on their line still belong here
    list.filter((b) => isUnpaid(b) && b.due_date && b.due_date <= wk && b.eb_connection_id && !dueIds.has(b.id)).forEach((b) => {
      const c = liveConns.find((x) => x.id === b.eb_connection_id);
      if (c) { due.push({ conn: c, open: b, nextDue: b.due_date }); dueIds.add(b.id); }
    });
    due.sort((a, b) => a.nextDue.localeCompare(b.nextDue));

    const row = (opts) => h('li', null, h('button', { class: 'dg-row link-row', onclick: opts.onclick }, h('span', { class: 'dot ' + opts.cls }),
      h('span', { class: 'dg-name' }, opts.name, opts.sub ? h('span', { class: 'dg-sub' }, opts.sub) : null),
      opts.amount != null ? h('span', { class: 'dg-state' }, opts.amount) : null,
      h('span', { class: 'dg-state ' + (opts.cls === 'bad' ? 'bad' : opts.cls === 'ok' ? 'ok' : '') }, opts.state), h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')));
    const whenText = (d) => (d < t0 ? 'was due ' + fmtDay(d) : d === t0 ? 'due today' : 'due ' + fmtDay(d));
    const dueRow = (t) => {
      const co = siteCo(t.conn.site_id), late = t.nextDue < t0;
      if (!t.open) return row({ cls: late ? 'bad' : 'warn', name: lineName(t.conn), sub: `${whenText(t.nextDue)} (expected) · consumer no. ${t.conn.service_no || '—'} · pay from ${payFrom(co)}`,
        state: canWrite() ? 'Download and upload' : 'Not uploaded yet', onclick: () => (canWrite() ? uploadBill(sitesData, t.conn.site_id, t.conn.id) : null) });
      const b = t.open;
      return row({ cls: late ? 'bad' : b.status === 'Approved' ? 'ok' : 'warn', name: `${lineName(t.conn)} · ${monthOf(b)}`, sub: `${whenText(t.nextDue)} · pay from ${payFrom(co)}`, amount: rupees(b.amount),
        state: b.status === 'Submitted' ? 'Waiting for approval' : 'Approved · pay and print slip', onclick: () => billDetail(b) });
    };
    const billRow = (b, state, cls) => row({ cls, name: `${b.site} · ${monthOf(b)}`, sub: [b.due_date ? whenText(b.due_date) : null, 'pay from ' + payFrom(siteCo(b.site_id))].filter(Boolean).join(' · '),
      amount: rupees(b.amount), state, onclick: () => billDetail(b) });
    const group = (title, count, items) => (items.length ? h('section', { class: 'panel dg' }, h('div', { class: 'dg-head' }, h('h2', null, title), h('span', { class: 'muted' }, count)), h('ul', { class: 'plain dg-list' }, items)) : null);
    const waitMore = waiting.filter((b) => !dueIds.has(b.id)), payMore = toPay.filter((b) => !dueIds.has(b.id));
    const weekView = [
      group('Bill due', `next 7 days · ${due.length}`, due.map(dueRow)),
      group(isOwner() ? 'Waiting for your approval' : 'Waiting for approval', String(waitMore.length), waitMore.map((b) => billRow(b, isOwner() ? 'open to approve' : 'with Harsha', 'warn'))),
      group('Approved, to pay', rupees(d3.sum(payMore, (b) => +b.amount || 0)), payMore.map((b) => billRow(b, 'pay and print slip', 'ok'))),
      group('Not linked to an EB line', String(unassigned.length), unassigned.map((b) => billRow(b, 'open to link', 'warn')))].filter(Boolean);

    // sites: company, account, and when each line's bill usually falls due
    const coSelect = (site) => {
      const s = select('co-' + site.id, site.company_id || '', [['', 'Choose company'], ...companies.map((c) => [c.id, c.name])]);
      s.classList.add('co-select'); s.setAttribute('aria-label', 'Company for ' + site.name);
      s.addEventListener('change', async () => {
        await q(sb.from('solar_sites').update({ company_id: s.value ? +s.value : null }).eq('id', site.id));
        site.company_id = s.value ? +s.value : null; toast(`${site.name}: ${s.value ? coById[s.value].name : 'no company'}`);
        const pf = s.closest('tr').querySelector('.co-pay'); if (pf) pf.textContent = (coById[s.value] || {}).pay_account || '';
      });
      return s;
    };
    const sitesView = h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'bill-desk' },
      h('thead', null, h('tr', null, ['Site', 'Company and account', 'Consumer no.', 'Usually', 'Next due', 'Latest bill'].map((c) => h('th', null, c)))),
      h('tbody', null, sites.flatMap((site) => {
        const mine = timing.filter((t) => t.conn.site_id === site.id);
        if (!mine.length) return [];
        const co = coById[site.company_id];
        return mine.map((t, i) => h('tr', null,
          h('th', { class: 'conn' }, i === 0 ? h('a', { href: '#site/' + site.id }, site.name) : null, multi.has(site.id) ? h('div', { class: 'muted small' }, t.conn.label) : null),
          h('td', null, i === 0 ? [canWrite() && companies.length ? coSelect(site) : h('span', null, co ? co.name : '—'), h('div', { class: 'muted small co-pay' }, co ? co.pay_account || '' : '')] : null),
          h('td', { class: 'nw' }, t.conn.service_no || '—'),
          h('td', null, typicalText(t)),
          h('td', { class: 'nw ' + (t.last && t.nextDue < t0 ? 'due-bad' : t.last && t.nextDue <= wk ? 'due-soon' : '') }, t.last ? fmtDate(t.nextDue) + (t.open ? '' : ' (expected)') : '—',
            t.missed ? h('div', { class: 'small due-bad' }, `${plural(t.missed, 'bill')} not uploaded`) : null),
          h('td', null, t.last ? h('button', { class: 'link', onclick: () => billDetail(t.last) }, `${monthOf(t.last)} · ${rupees(t.last.amount)} · ${t.last.status === 'Submitted' ? 'waiting for approval' : t.last.paid ? 'paid' : t.last.status === 'Approved' ? 'approved, not paid' : t.last.status.toLowerCase()}`)
            : canWrite() ? h('button', { class: 'link', onclick: () => uploadBill(sitesData, site.id, t.conn.id) }, 'Upload first bill') : '—')));
      })))));
    const noCo = sites.filter((s) => liveConns.some((c) => c.site_id === s.id) && !s.company_id).length;

    const cell = (c, m) => {
      const here = list.filter((b) => b.eb_connection_id === c.id && billMonth(b) === m);
      if (!here.length) {
        return h('td', { class: 'bill-cell empty-cell' }, canWrite()
          ? h('button', { class: 'cell-add', 'aria-label': `Upload the ${mLabel(m)} bill for ${c.label}`, onclick: () => uploadBill(sitesData, c.site_id, c.id, m) }, '+') : '');
      }
      return h('td', { class: 'bill-cell' }, here.map((b) => h('button', {
        class: 'bill-chip ' + (b.status === 'Approved' ? 'ok' : b.status === 'Rejected' ? 'bad' : 'wait') + (isUnpaid(b) ? ' unpaid' : ''), onclick: () => billDetail(b),
        title: `${b.site} · ${b.status === 'Submitted' ? 'awaiting approval' : b.status.toLowerCase()}${isUnpaid(b) ? ' · not paid' + (b.due_date ? ', due ' + fmtDay(b.due_date) : '') : b.paid ? ' · paid' : ''}` },
        h('span', { class: 'u' }, n0(b.billed_kwh ?? b.import_kwh)), h('span', { class: 'a' }, b.amount == null ? '' : '₹' + d3.format('.3~s')(b.amount)))));
    };
    const grid = h('div', { class: 'table-wrap' }, h('table', { class: 'bill-grid' },
      h('thead', null, h('tr', null, h('th', null, 'Site'), months.map((m) => h('th', { class: 'n' }, mLabel(m))))),
      h('tbody', null, sites.flatMap((site) => {
        const mine = liveConns.filter((c) => c.site_id === site.id);
        if (!mine.length) return [];
        if (mine.length === 1) return [h('tr', null, h('th', { class: 'conn' }, h('a', { href: '#site/' + site.id }, site.name)), months.map((m) => cell(mine[0], m)))];
        return [h('tr', { class: 'group' }, h('th', { colspan: months.length + 1 }, h('a', { href: '#site/' + site.id }, site.name), h('span', { class: 'muted' }, ` · ${mine.length} EB lines`))),
          ...mine.map((c) => h('tr', null, h('th', { class: 'conn sub' }, c.label), months.map((m) => cell(c, m))))];
      }))));

    if (!['week', 'sites', 'all'].includes(billState.view)) billState.view = 'week';
    const view = billState.view;
    const segs = h('div', { class: 'segs page-tabs' },
      [['week', `This week · ${due.length + waitMore.length + payMore.length}`], ['sites', 'Sites and due dates'], ['all', 'All bills']].map(([k, l]) =>
        h('button', { class: 'seg', type: 'button', 'aria-pressed': String(view === k), onclick: () => { billState.view = k; route(); } }, l)));
    const sub = {
      week: 'Bills due in the next 7 days come first. Download the bill from TNEB, upload it here, and it goes to Harsha to approve. Once approved, pay from the account shown and print the slip.',
      sites: 'Which company each site is under, the account to pay from, and when its bill usually falls due.',
      all: 'One row per site, one column per month. Click a bill to open it, or + to upload one.' }[view];
    main.replaceChildren(...[
      pageHead('EB bills', sub, canWrite() ? h('button', { class: 'btn primary', onclick: () => uploadBill(sitesData) }, 'Upload a bill') : null),
      segs,
      ...(view === 'all' ? [
        h('p', { class: 'legend small' }, h('span', { class: 'bill-chip ok' }, 'Approved'), h('span', { class: 'bill-chip wait' }, 'Awaiting approval'), h('span', { class: 'bill-chip ok unpaid' }, 'Not paid yet')),
        h('div', { class: 'panel' }, grid)]
        : view === 'sites' ? [
          !companies.length ? h('p', { class: 'note-bar' }, 'No companies yet. ', h('a', { href: '#companies' }, 'Add your companies and their pay-from accounts'), ' so each site can be set to the right one.')
            : noCo ? h('p', { class: 'note-bar' }, `${plural(noCo, 'site')} still need a company. Choose it in the Company column. `, h('a', { href: '#companies' }, 'Edit companies')) : h('p', { class: 'muted small' }, h('a', { href: '#companies' }, 'Edit companies and accounts')),
          sitesView]
        : weekView.length ? [h('div', { class: 'desk-list' }, weekView)]
        : [h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No bills due in the next 7 days, and nothing waiting.'), h('button', { class: 'link more-link', onclick: () => { billState.view = 'sites'; route(); } }, 'See when each site is due →'))])].filter(Boolean));
    if (view === 'all') grid.scrollLeft = grid.scrollWidth; // newest months first in view
  }

  /* ---------- companies: which account pays which site's bill ---------- */
  async function companies() {
    const [list, { sites }] = await Promise.all([q(sb.from('solar_companies').select('*').order('sort').order('name')), loadSites()]);
    const edit = (co) => {
      const name = input('co-name', co ? co.name : '', { required: true, placeholder: 'For example: Vaikund Estates Pvt. Ltd.' });
      const acct = input('co-acct', co ? co.pay_account : '', { placeholder: 'Bank and last 4 digits only, e.g. HDFC current ··4321' });
      const notes = h('textarea', { id: 'co-notes' }, co ? co.notes || '' : '');
      openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
        e.preventDefault();
        if (/\d{6,}/.test(acct.value.replace(/[\s-]/g, ''))) { toast('Type only the bank and the last 4 digits, not the full account number.', true); acct.focus(); return; }
        const row = { name: name.value.trim(), pay_account: acct.value.trim() || null, notes: notes.value.trim() || null };
        await q(co ? sb.from('solar_companies').update(row).eq('id', co.id) : sb.from('solar_companies').insert(row));
        closeDialog(); toast(co ? 'Company saved' : 'Company added'); route();
      } },
        h('div', { class: 'dlg-head' }, h('h2', null, co ? 'Edit company' : 'Add a company'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
        h('div', { class: 'form-grid' }, field('Company name', name, 'wide'), field('Pay EB bills from', acct, 'wide'), field('Notes', notes, 'wide')),
        h('p', { class: 'muted small' }, 'This label is printed on the approval slip so accounts know which account to pay from. Keep the full account number out of here.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
    };
    main.replaceChildren(
      pageHead('Companies', 'The company each site is under, and the account its EB bills are paid from. Set each site\'s company on the EB bills page, under Sites and due dates.',
        canWrite() ? h('button', { class: 'btn primary', onclick: () => edit(null) }, 'Add a company') : null),
      list.length ? h('section', { class: 'panel dg' }, h('ul', { class: 'plain dg-list' }, list.map((co) => {
        const n = sites.filter((s) => s.company_id === co.id).length;
        return h('li', null, h('button', { class: 'dg-row link-row', onclick: () => (canWrite() ? edit(co) : null) }, h('span', { class: 'dot ok' }),
          h('span', { class: 'dg-name' }, co.name, h('span', { class: 'dg-sub' }, co.pay_account ? 'Pay from ' + co.pay_account : 'No pay-from account yet')),
          h('span', { class: 'dg-state' }, plural(n, 'site')), h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')));
      }))) : h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No companies yet. Add one for each company that pays EB bills.')));
  }

  /* ---------- approval slip: printed for accounts once Harsha approves a bill ---------- */
  async function slip(id) {
    const b = await q(sb.from('solar_eb_bills').select('*').eq('id', id).maybeSingle());
    if (!b) { main.replaceChildren(h('p', { class: 'empty' }, 'That bill was not found. ', h('a', { href: '#bills' }, 'Back to EB bills'))); return; }
    const [site, conn] = await Promise.all([
      b.site_id ? q(sb.from('solar_sites').select('*').eq('id', b.site_id).maybeSingle()) : null,
      b.eb_connection_id ? q(sb.from('solar_eb_connections').select('*').eq('id', b.eb_connection_id).maybeSingle()) : null]);
    const co = site && site.company_id ? await q(sb.from('solar_companies').select('*').eq('id', site.company_id).maybeSingle()) : null;
    const bar = h('div', { class: 'slip-bar no-print' }, h('a', { class: 'back', href: '#bills' }, '← EB bills'),
      b.status === 'Approved' ? h('button', { class: 'btn primary', onclick: () => window.print() }, 'Print') : null);
    if (b.status !== 'Approved') { main.replaceChildren(bar, h('section', { class: 'panel' }, h('p', { class: 'empty' }, b.status === 'Submitted' ? 'This bill is still waiting for approval. The slip can be printed once it is approved.' : 'This bill was rejected, so there is no slip.'))); return; }
    const r = (k, v, cls) => h('div', { class: 'slip-row ' + (cls || '') }, h('dt', null, k), h('dd', null, v ?? '—'));
    main.replaceChildren(bar, h('article', { class: 'slip' },
      h('header', { class: 'slip-head' },
        h('div', null, h('div', { class: 'slip-co' }, co ? co.name : 'Company not set'), h('div', { class: 'muted' }, 'EB bill payment · slip no. ' + b.id)),
        h('div', { class: 'slip-stamp' }, 'Approved for accounts')),
      h('dl', { class: 'slip-grid' },
        r('Pay from', co && co.pay_account ? co.pay_account : 'Account not set. Ask Harsha.', 'big'),
        r('Amount', b.amount == null ? '—' : '₹' + d3.format(',.2f')(b.amount), 'big'),
        r('Pay by', b.due_date ? fmtDate(b.due_date) : '—', 'big'),
        r('Site', site ? site.name : b.site), r('EB line', conn ? conn.label : null), r('Consumer no.', b.service_no || (conn && conn.service_no)),
        r('Bill date', b.bill_date ? fmtDate(b.bill_date) : null), r('Period', b.period_from ? `${fmtDate(b.period_from)} to ${fmtDate(b.period_to)}` : null),
        r('Units billed', b.billed_kwh != null || b.import_kwh != null ? n0(billUnits(b)) : null),
        r('Uploaded by', `${b.uploaded_by_name || '—'} · ${fmtDate(istDate(b.uploaded_at))}`),
        r('Approved by', `${b.reviewed_by_name || 'Harsha'}${b.reviewed_at ? ' · ' + fmtDate(istDate(b.reviewed_at)) : ''}`),
        b.paid ? r('Paid', `${b.paid_on ? fmtDate(b.paid_on) : ''}${b.paid_from ? ' from ' + b.paid_from : ''}${b.paid_ref ? ' · ref ' + b.paid_ref : ''}`) : null),
      b.review_note ? h('div', { class: 'slip-note' }, h('h3', null, 'Note from Harsha'), h('p', null, b.review_note)) : null,
      h('div', { class: 'slip-sign' }, ['Paid by', 'Payment ref / UTR', 'Date'].map((l) => h('div', null, h('span', null), l))),
      h('p', { class: 'muted small slip-foot' }, `Printed ${fmtDate(today())} from Solar Fleet`)));
  }

  function uploadBill(sitesData, presetSite, presetConn, presetMonth) {
    const { sites, conns } = sitesData;
    const sys = select('bl-site', presetSite || '', [['', 'Choose a site'], ...sites.map((x) => [x.id, x.name])]);
    sys.required = true;
    const conn = select('bl-conn', '', [['', 'Choose the EB connection']]);
    const fillConns = () => {
      const mine = conns.filter((c) => c.site_id === sys.value);
      conn.replaceChildren(...[['', mine.length ? 'Choose the EB connection' : 'No EB connections at this site yet'], ...mine.map((c) => [c.id, c.label + (c.service_no ? ' · ' + c.service_no : '')])]
        .map(([v, l]) => h('option', { value: v }, l)));
      const pick = presetConn && mine.some((c) => c.id === presetConn) ? presetConn : mine.length === 1 ? mine[0].id : null;
      if (pick != null) { conn.value = String(pick); conn.dispatchEvent(new Event('change')); }
    };
    sys.addEventListener('change', fillConns);
    const f = {
      service: input('bl-service', ''), billDate: input('bl-date', presetMonth ? presetMonth + '-01' : '', { type: 'date' }),
      from: input('bl-from', '', { type: 'date' }), to: input('bl-to', '', { type: 'date' }),
      imp: input('bl-imp', '', { type: 'number', step: 'any', min: 0 }), exp: input('bl-exp', '', { type: 'number', step: 'any', min: 0 }),
      billed: input('bl-billed', '', { type: 'number', step: 'any', min: 0 }), amount: input('bl-amount', '', { type: 'number', step: 'any', min: 0 }),
      due: input('bl-due', presetMonth ? addDays(presetMonth + '-01', 20) : '', { type: 'date' }),
      file: input('bl-file', '', { type: 'file', accept: 'application/pdf,image/*', required: true }),
      notes: h('textarea', { id: 'bl-notes' }),
      pf: input('bl-pf', '', { type: 'number', step: 'any', min: 0, placeholder: '0' }), ed: input('bl-ed', '', { type: 'number', step: 'any', min: 0, placeholder: '0' }),
      late: input('bl-late', '', { type: 'number', step: 'any', min: 0, placeholder: '0' }), pfv: input('bl-pfv', '', { type: 'number', step: 'any', min: 0, max: 1, placeholder: 'e.g. 0.86' }),
      kw: input('bl-kw', '', { type: 'number', step: 'any', min: 0 }),
    };
    conn.addEventListener('change', () => { const c = conns.find((x) => String(x.id) === conn.value); if (c && c.service_no && !f.service.value) f.service.value = c.service_no; });
    if (presetSite) setTimeout(fillConns);
    // TNEB bills fall due 20 days after the bill date; fill it in unless the admin has typed a date
    let dueTyped = false;
    f.due.addEventListener('input', () => { dueTyped = true; });
    const autoDue = () => { const base = f.billDate.value || f.to.value; if (!dueTyped && base) f.due.value = addDays(base, 20); };
    f.billDate.addEventListener('change', autoDue); f.to.addEventListener('change', autoDue);
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Submit for approval');
    const num = (el) => (el.value === '' ? null : +el.value);
    const form = h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const file = f.file.files[0];
      if (!file) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const site = sites.find((x) => x.id === sys.value);
        const c = conns.find((x) => String(x.id) === conn.value);
        const safe = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${sys.value}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('solar-bills').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        await q(sb.from('solar_eb_bills').insert({
          site_id: sys.value, eb_connection_id: c ? c.id : null,
          site: site.name + (c ? ' · ' + c.label : ''), service_no: f.service.value.trim() || null,
          bill_date: f.billDate.value || null, period_from: f.from.value || null, period_to: f.to.value || null,
          import_kwh: num(f.imp), export_kwh: num(f.exp), billed_kwh: num(f.billed), amount: num(f.amount), due_date: f.due.value || null,
          pf_penalty: num(f.pf), excess_demand: num(f.ed), late_fee: num(f.late), power_factor: num(f.pfv), demand_kw: num(f.kw),
          file_path: path, file_name: file.name, notes: f.notes.value.trim() || null,
          uploaded_by: state.user.id, uploaded_by_name: state.me.name }));
        closeDialog(); toast('Bill submitted for approval'); refreshCounts(); route();
      } catch (err) {
        toast(err.message || 'Upload failed', true); btn.disabled = false; btn.textContent = 'Submit for approval';
      }
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'Upload an EB bill'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('p', { class: 'muted' }, 'Copy the figures from the bill so they can be compared with the meters. Leave any you can\'t find blank.'),
      h('div', { class: 'form-grid' },
        field('Site', sys), field('EB connection', conn), field('Consumer number', f.service), field('Bill date', f.billDate),
        field('Period from', f.from), field('Period to', f.to),
        field('Units imported (kWh)', f.imp), field('Units exported (kWh)', f.exp),
        field('Units billed (kWh)', f.billed), field('Amount (₹)', f.amount), field('Pay by (due date)', f.due),
        h('div', { class: 'field wide form-sub' }, h('strong', null, 'Penalties on the bill'), h('span', { class: 'muted small' }, ' Look for these lines on the bill. Leave blank if they are not there.')),
        field('Power factor penalty (₹)', f.pf), field('Excess demand charge (₹)', f.ed), field('Late payment fee (₹)', f.late),
        field('Power factor (PF)', f.pfv), field('Recorded demand (kW)', f.kw),
        field('Bill file (PDF or photo)', f.file, 'wide'), field('Notes', f.notes, 'wide')),
      h('div', { class: 'actions' }, btn));
    openDialog(form);
  }

  // the plain-words check shown on top of a bill: last bill, penalties, anything odd
  function billCheck(b, earlier, conn) {
    const units = (x) => (x ? +(x.billed_kwh ?? x.import_kwh) : null);
    const pct = (a, p) => (a != null && p ? Math.round(((a - p) / p) * 100) : null);
    const prev = earlier[0];
    const myDate = b.period_to || b.bill_date;
    const yearAgo = earlier.find((x) => myDate && (x.period_to || x.bill_date) && Math.abs(dayDiff(myDate, x.period_to || x.bill_date) - 365) <= 25);
    const pens = [['Power factor penalty', b.pf_penalty, b.power_factor ? `PF ${b.power_factor}` : null], ['Excess demand charge', b.excess_demand, b.demand_kw ? `demand ${b.demand_kw} kW${conn && conn.sanctioned_kw ? ' on ' + conn.sanctioned_kw + ' kW sanctioned' : ''}` : null], ['Late payment fee', b.late_fee, null]]
      .filter(([, v]) => +v > 0).map(([k, v, why]) => `${k} ${rupees(v)}${why ? ' (' + why + ')' : ''}`);
    const flags = [];
    const du = pct(units(b), units(prev)), da = pct(+b.amount, prev && +prev.amount);
    if (du != null && du >= 30) flags.push(`Units up ${du}% on the last bill`);
    else if (du != null && du <= -40) flags.push(`Units down ${-du}% on the last bill. Check the meter reading.`);
    if (da != null && da >= 30 && !(du != null && du >= 30)) flags.push(`Amount up ${da}% though units did not rise as much`);
    const rate = units(b) ? +b.amount / units(b) : null, rateP = prev && units(prev) ? +prev.amount / units(prev) : null;
    if (rate && rateP && rate > rateP * 1.2) flags.push(`Cost per unit up from ₹${rateP.toFixed(1)} to ₹${rate.toFixed(1)}`);
    const yu = pct(units(b), units(yearAgo));
    if (yu != null && yu >= 40) flags.push(`Units up ${yu}% on the same bill last year`);
    if (conn && conn.sanctioned_kw && +b.demand_kw > +conn.sanctioned_kw && !(+b.excess_demand > 0)) flags.push(`Demand ${b.demand_kw} kW is above the ${conn.sanctioned_kw} kW sanctioned`);
    if (b.power_factor && +b.power_factor < 0.9 && !(+b.pf_penalty > 0)) flags.push(`Power factor is low at ${b.power_factor}`);
    if (prev && +prev.export_kwh > 0 && !(+b.export_kwh > 0)) flags.push('No units exported this time, though the last bill had export. Check the solar.');
    if (b.period_from && b.period_to && dayDiff(b.period_to, b.period_from) > 70) flags.push(`Bill covers ${dayDiff(b.period_to, b.period_from)} days, longer than usual`);
    if (earlier.some((x) => x.bill_date && x.bill_date === b.bill_date)) flags.push('Another bill on this line has the same bill date. It may be a duplicate.');
    if (earlier.some((x) => x.status !== 'Rejected' && !x.paid && x.due_date && x.due_date < (b.bill_date || today()))) flags.push('An earlier bill on this line is not marked paid');
    if (!b.file_path) flags.push('No bill file attached');
    return { prev, units, pct, pens, flags };
  }

  async function billDetail(b) {
    let link = null;
    if (b.file_path) {
      const s = await sb.storage.from('solar-bills').createSignedUrl(b.file_path, 600);
      link = s.data && s.data.signedUrl;
    }
    // context: earlier bills on the same line, your last comment, and notes on the line, site and systems
    const [prevBills, conn, site, sysList, tasks, siteConns] = await Promise.all([
      b.eb_connection_id || b.site_id ? q(sb.from('solar_eb_bills').select('id, period_from, period_to, bill_date, due_date, uploaded_at, billed_kwh, import_kwh, export_kwh, amount, status, paid, review_note, reviewed_at, reviewed_by_name, pf_penalty, excess_demand, late_fee, power_factor, demand_kw')
        .eq(b.eb_connection_id ? 'eb_connection_id' : 'site_id', b.eb_connection_id || b.site_id).neq('id', b.id).order('period_to', { ascending: false }).limit(24)) : Promise.resolve([]),
      b.eb_connection_id ? q(sb.from('solar_eb_connections').select('*').eq('id', b.eb_connection_id).maybeSingle()) : Promise.resolve(null),
      b.site_id ? q(sb.from('solar_sites').select('*').eq('id', b.site_id).maybeSingle()) : Promise.resolve(null),
      b.site_id ? q(sb.from('solar_system_status').select('id, system, type, tracking, attention, notes, open_issue').eq('site_id', b.site_id).order('sort')) : Promise.resolve([]),
      b.site_id ? q(sb.from('solar_tickets').select('id, reason, due, type').eq('site_id', b.site_id).neq('status', 'Closed').order('due')) : Promise.resolve([]),
      b.site_id ? q(sb.from('solar_eb_connections').select('id').eq('site_id', b.site_id).neq('tracking', 'Retired')) : Promise.resolve([]),
    ]);
    const co = site && site.company_id ? await q(sb.from('solar_companies').select('*').eq('id', site.company_id).maybeSingle()) : null;
    const multiLine = siteConns.length > 1;
    const title = site ? site.name + (multiLine && conn ? ' · ' + conn.label : '') : b.site;
    const myDate = b.period_to || b.bill_date || '';
    const earlier = prevBills.filter((x) => (x.period_to || x.bill_date || '') <= myDate);
    const comments = prevBills.filter((x) => x.review_note && x.status !== 'Submitted').slice(0, 3);
    const units = (x) => +(x.billed_kwh ?? x.import_kwh);
    const change = (a, p) => (a && p ? Math.round(((a - p) / p) * 100) : null);
    const pct = (v) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`);
    const prev = earlier[0];
    const yearAgo = earlier.find((x) => myDate && x.period_to && Math.abs((Date.parse(myDate) - Date.parse(x.period_to)) / 864e5 - 365) <= 25);
    const ctxBlock = (title, ...kids) => { const k = kids.flat().filter(Boolean); return k.length ? h('div', { class: 'ctx' }, h('h3', null, title), ...k) : null; };
    const context = h('div', { class: 'ctx-grid' },
      ctxBlock(isOwner() ? 'Your earlier comments' : 'Harsha\'s earlier comments',
        comments.length ? comments.map((x) => [h('p', { class: 'ctx-quote' }, x.review_note),
          h('p', { class: 'muted small' }, `${monthOf(x)} bill · ${x.status.toLowerCase()}${x.reviewed_at ? ' on ' + fmtDate(istDate(x.reviewed_at)) : ''}`)])
          : h('p', { class: 'muted' }, 'No comments on earlier bills for this line.')),
      ctxBlock('Against earlier bills',
        prev ? h('p', null, `Previous bill: ${n0(units(prev))} units, ₹${d3.format(',.0f')(prev.amount)}. This one is ${n0(units(b))} units${pct(change(units(b), units(prev)))}, ₹${d3.format(',.0f')(b.amount)}${pct(change(+b.amount, +prev.amount))}.`) : h('p', { class: 'muted' }, 'No earlier bill for this line.'),
        yearAgo ? h('p', null, `Same bill last year: ${n0(units(yearAgo))} units, ₹${d3.format(',.0f')(yearAgo.amount)}${pct(change(units(b), units(yearAgo)))} on units.`) : null,
        earlier.length ? h('p', { class: 'muted' }, 'Recent: ' + earlier.slice(0, 6).map((x) => `${d3.utcFormat('%b %y')(new Date(x.period_to || x.bill_date))} ${n0(units(x))}`).join(' · ')) : null),
      ctxBlock('Site', site ? [
        h('p', null, h('a', { href: '#site/' + site.id, onclick: closeDialog }, site.name), site.site_type ? ` · ${site.site_type}` : ''),
        conn ? h('p', null, [conn.service_no && 'Consumer no. ' + conn.service_no, conn.sanctioned_kw != null ? conn.sanctioned_kw + ' kW sanctioned' : null].filter(Boolean).join(' · ')) : null,
        conn && (conn.incharge || conn.contact_phone) ? h('p', null, `In charge: ${[conn.incharge, conn.contact_phone].filter(Boolean).join(', ')}`) : null,
        conn && conn.notes ? h('p', { class: 'ctx-notes' }, conn.notes) : null,
        site.notes ? h('p', { class: 'ctx-notes' }, site.notes) : null,
        site.extra_items ? h('p', { class: 'muted' }, 'Extra items: ' + site.extra_items) : null,
        tasks.length ? h('p', null, 'Open: ' + tasks.map((t) => `${t.reason}${t.due ? ' (due ' + fmtDay(t.due) + ')' : ''}`).join('; ')) : null] : null),
      ctxBlock('Solar systems here', sysList.map((x) => h('div', { class: 'ctx-sys' },
        h('p', null, h('strong', null, `${x.id} ${x.system || x.type || ''}`), ` · ${x.tracking === 'Live' ? (x.attention && !['OK', 'Open item'].includes(x.attention) ? x.attention : 'tracked, OK') : x.tracking === 'Pending' ? 'not tracked yet' : x.tracking.toLowerCase()}`),
        x.open_issue ? h('p', { class: 'due-bad' }, x.open_issue) : null,
        x.notes ? h('p', { class: 'ctx-notes' }, x.notes) : null))));
    const note = h('textarea', { id: 'bd-note', placeholder: 'Your comment on this bill. Shown next time a bill for this line comes in. Needed when rejecting.' }, b.review_note || '');
    const review = async (status) => {
      if (status === 'Rejected' && !note.value.trim()) { toast('Add a note saying why the bill is rejected.', true); note.focus(); return; }
      await q(sb.from('solar_eb_bills').update({ status, review_note: note.value.trim() || null }).eq('id', b.id));
      closeDialog(); toast(status === 'Approved' ? 'Bill approved. It can now be paid and its slip printed.' : 'Bill rejected'); refreshCounts(); route();
    };
    const kv = (k, v) => h('div', { class: 'field' }, h('label', null, k), h('div', { class: 'num' }, v));
    const ps = payState(b);
    const payDate = input('bd-paid', today(), { type: 'date', max: today() });
    const paidFrom = input('bd-from', (co && co.pay_account) || '', { placeholder: 'Account paid from' });
    const paidRef = input('bd-ref', '', { placeholder: 'UTR or cheque no.' });
    const setPaid = async (paid) => {
      if (paid && /\d{6,}/.test(paidFrom.value.replace(/[\s-]/g, ''))) { toast('Type only the bank and last 4 digits of the account.', true); paidFrom.focus(); return; }
      await q(sb.from('solar_eb_bills').update(paid ? { paid: true, paid_on: payDate.value || today(), paid_by_name: state.me.name, paid_from: paidFrom.value.trim() || null, paid_ref: paidRef.value.trim() || null } : { paid: false }).eq('id', b.id));
      closeDialog(); toast(paid ? 'Marked as paid' : 'Marked as not paid'); route();
    };
    const payRow = ps === 'none' ? null : h('div', { class: 'pay-row ' + ps }, b.paid
      ? [h('strong', null, `Paid${b.paid_on ? ' on ' + fmtDate(b.paid_on) : ''}${b.paid_from ? ' from ' + b.paid_from : ''}`), b.paid_ref ? h('span', null, 'ref ' + b.paid_ref) : null, b.paid_by_name ? h('span', { class: 'muted' }, `marked by ${b.paid_by_name}`) : null,
        canWrite() ? h('button', { class: 'link', onclick: () => setPaid(false) }, 'Mark as not paid') : null]
      : [h('strong', null, b.due_date ? `${ps === 'overdue' ? 'Not paid. Was due' : 'Not paid yet. Due'} ${fmtDate(b.due_date)}` : 'Not paid yet'),
        b.status !== 'Approved' ? h('span', { class: 'muted' }, 'Pay once Harsha approves it.')
          : canWrite() ? h('span', { class: 'pay-act' }, h('label', { for: 'bd-paid', class: 'muted' }, 'Paid on'), payDate, paidFrom, paidRef, h('button', { class: 'btn', onclick: () => setPaid(true) }, 'Mark as paid')) : null]);
    const ck = billCheck(b, earlier, conn);
    const chg = (a, p) => { const v = ck.pct(a, p); return v == null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`; };
    const quick = h('section', { class: 'quick' },
      h('div', { class: 'quick-figs' },
        h('div', null, h('span', { class: 'q-l' }, 'This bill'), h('span', { class: 'q-v' }, rupees(b.amount)), h('span', { class: 'q-s' }, `${n0(ck.units(b))} units${b.due_date ? ' · due ' + fmtDay(b.due_date) : ''}`)),
        h('div', null, h('span', { class: 'q-l' }, ck.prev ? `Last bill · ${monthOf(ck.prev)}` : 'Last bill'), h('span', { class: 'q-v' }, ck.prev ? rupees(ck.prev.amount) : '—'),
          h('span', { class: 'q-s' }, ck.prev ? `${n0(ck.units(ck.prev))} units · this one${chg(ck.units(b), ck.units(ck.prev))} on units` : 'No earlier bill here'))),
      h('div', { class: 'quick-row ' + (ck.pens.length ? 'bad' : 'ok') }, h('strong', null, 'Penalty: '), ck.pens.length ? ck.pens.join(' · ') : 'None'),
      h('div', { class: 'quick-row ' + (ck.flags.length ? 'warn' : 'ok') }, h('strong', null, ck.flags.length ? 'Looks off:' : 'Anything odd: '),
        ck.flags.length ? h('ul', null, ck.flags.map((f) => h('li', null, f))) : 'Nothing unusual'),
      comments.length ? h('div', { class: 'quick-row note' }, h('strong', null, isOwner() ? 'Your last comment: ' : 'Harsha\'s last comment: '), `“${comments[0].review_note}” (${monthOf(comments[0])} bill)`) : null);
    const decide = isOwner() && b.status === 'Submitted' ? [h('div', { class: 'form-grid' }, field('Your comment', note, 'wide')),
      h('div', { class: 'actions' }, h('button', { class: 'btn reject', onclick: () => review('Rejected') }, 'Reject'), h('button', { class: 'btn approve', onclick: () => review('Approved') }, 'Approve'))] : [];
    openDialog(h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Close')),
      quick,
      ...decide,
      b.status === 'Approved' ? h('div', { class: 'approved-bar' }, h('strong', null, '✓ Approved for accounts'),
        h('a', { class: 'btn', href: '#slip/' + b.id, onclick: closeDialog }, 'Print approval slip')) : null,
      payRow,
      b.review_note && b.status !== 'Submitted' ? h('p', null, 'Your comment: ' + b.review_note) : null,
      link ? h('p', null, h('a', { href: link, target: '_blank', rel: 'noopener' }, 'Open the bill file')) : null,
      h('details', { class: 'more-details' }, h('summary', null, 'Full bill details and site history'),
      h('div', { class: 'form-grid' },
        kv('Consumer number', b.service_no || '—'), kv('Bill date', fmtDate(b.bill_date)), kv('Due date', b.due_date ? fmtDate(b.due_date) : '—'),
        kv('Period', b.period_from ? `${fmtDate(b.period_from)} to ${fmtDate(b.period_to)}` : '—'),
        kv('Units imported', n0(b.import_kwh)), kv('Units exported', n0(b.export_kwh)), kv('Units billed', n0(b.billed_kwh)),
        kv('Amount', b.amount == null ? '—' : '₹' + d3.format(',.0f')(b.amount)),
        kv('Uploaded', `${b.uploaded_by_name || ''} · ${d3.timeFormat('%-d %b %Y')(new Date(b.uploaded_at))}`),
        kv('Status', b.status === 'Submitted' ? 'Awaiting approval' : b.status === 'Approved' ? `Approved${b.reviewed_by_name ? ' by ' + b.reviewed_by_name : ''}${b.reviewed_at ? ' · ' + fmtDate(istDate(b.reviewed_at)) : ''}` : b.status),
        kv('Company', co ? co.name : 'Not set'), kv('Pay from', co && co.pay_account ? co.pay_account : '—'),
        kv('Power factor', b.power_factor ?? '—'), kv('Recorded demand', b.demand_kw != null ? b.demand_kw + ' kW' : '—')),
      b.notes ? h('p', null, b.notes) : null,
      context)));
  }

  /* ---------- daylight grid import ---------- */
  async function grid() {
    const [rows, { sites, conns }] = await Promise.all([
      q(sb.from('solar_eb_import').select('*').gte('date', addDays(today(), -45)).order('date')),
      loadSites(),
    ]);
    const siteName = Object.fromEntries(sites.map((x) => [x.id, x.name]));
    const live = conns.filter((c) => c.tracking === 'Live');
    const notLive = conns.filter((c) => c.tracking !== 'Live' && c.tracking !== 'Retired');
    const head = pageHead('Daylight grid import', `Units each EB line takes between ${state.settings.daylight_start || '06:30'} and ${state.settings.daylight_end || '17:30'}. The aim is close to zero. Set a target on each EB connection from the Sites page.`);
    const last = d3.max(rows, (r) => r.date) || addDays(today(), -1);
    const days = d3.range(13, -1, -1).map((k) => addDays(last, -k));
    const card = (c) => {
      const mine = rows.filter((r) => r.eb_connection_id === c.id);
      const head2 = [h('h3', null, `${siteName[c.site_id] || ''} · ${c.label}`), h('p', { class: 'muted' }, `${c.code} · via ${c.tracked_via}`)];
      if (!mine.length) return h('div', { class: 'panel' }, ...head2, h('p', { class: 'due-bad' }, 'No readings received yet.'));
      const good = mine.filter((r) => r.daylight_kwh != null && !/^Partial/.test(r.note || '')).map((r) => +r.daylight_kwh);
      const usual = good.length ? d3.median(good) : null;
      const latest = mine[mine.length - 1];
      const chart = h('div', { class: 'chart' });
      requestAnimationFrame(() => importChart(chart, mine, days, c.daylight_target_kwh));
      return h('div', { class: 'panel' }, ...head2,
        h('div', { class: 'card-fig' }, h('span', { class: 'v' }, n1(latest.daylight_kwh)), h('span', { class: 'muted' }, 'units in daylight on ' + fmtDay(latest.date))),
        h('p', { class: 'muted num' }, `Usual ${n1(usual)} · target ${c.daylight_target_kwh == null ? 'not set' : n1(c.daylight_target_kwh)} · whole day ${n1(latest.day_kwh)}`),
        chart);
    };
    main.replaceChildren(...[head,
      live.length ? h('div', { class: 'cards' }, live.map(card)) : h('p', { class: 'panel empty' }, 'No EB line is set to Live tracking yet.'),
      notLive.length ? h('section', null, h('h2', null, `Not tracked yet · ${notLive.length}`),
        h('div', { class: 'panel' }, h('ul', { class: 'plain queue' }, notLive.map((c) => h('li', null,
          h('a', { href: '#site/' + c.site_id }, `${siteName[c.site_id] || c.site_id} · ${c.label}`), h('span', { class: 'muted' }, ` · ${c.code} · ${c.tracked_via}`)))))) : null].filter(Boolean));
  }

  function importChart(box, mine, days, target) {
    const W = Math.max(260, box.clientWidth || 320), H = 130, m = { t: 8, r: 6, b: 20, l: 32 };
    const by = new Map(mine.map((r) => [r.date, r]));
    const max = Math.max(d3.max(mine, (r) => +r.daylight_kwh || 0) || 0, target || 0, 1);
    const x = d3.scaleBand(days, [m.l, W - m.r]).padding(0.25);
    const y = d3.scaleLinear([0, max * 1.1], [H - m.b, m.t]).nice(3);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Daylight grid import, last 14 days');
    svg.append('g').selectAll('line').data(y.ticks(3)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', 'var(--line)');
    svg.append('g').selectAll('text').data(y.ticks(3)).join('text').attr('x', m.l - 6).attr('y', y).attr('dy', '.32em').attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--muted)').text((d) => d3.format('~s')(d));
    svg.append('g').selectAll('rect').data(days.filter((d) => by.get(d) && +by.get(d).daylight_kwh > 0)).join('rect')
      .attr('x', (d) => x(d)).attr('width', x.bandwidth()).attr('rx', 2)
      .attr('y', (d) => y(+by.get(d).daylight_kwh)).attr('height', (d) => y(0) - y(+by.get(d).daylight_kwh))
      .attr('fill', (d) => (target != null && +by.get(d).daylight_kwh > target ? 'var(--bad)' : 'var(--grid)'))
      .attr('fill-opacity', (d) => (/^Partial/.test(by.get(d).note || '') ? 0.4 : 1));
    if (target != null) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(target)).attr('y2', y(target)).attr('stroke', 'var(--ink)').attr('stroke-dasharray', '4 3');
    svg.append('g').selectAll('text').data([days[0], days[days.length - 1]]).join('text').attr('x', (d, i) => (i ? x(d) + x.bandwidth() : x(d))).attr('y', H - 5)
      .attr('text-anchor', (d, i) => (i ? 'end' : 'start')).attr('font-size', 10).attr('fill', 'var(--muted)').text(fmtDay);
    const tip = h('div', { class: 'tip', hidden: true });
    svg.append('g').selectAll('rect').data(days).join('rect').attr('x', (d) => x(d)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.b - m.t).attr('fill', 'transparent')
      .on('mousemove', (ev, d) => {
        const r = by.get(d);
        tip.replaceChildren(h('div', { class: 'muted' }, fmtDay(d)), r ? `${n1(r.daylight_kwh)} units in daylight, ${n1(r.day_kwh)} all day` : 'No reading', r && r.note ? h('div', { class: 'muted' }, r.note) : null);
        tip.hidden = false;
        const b = box.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(0, ev.clientX - b.left + 10), b.width - tip.offsetWidth) + 'px';
        tip.style.top = Math.max(0, ev.clientY - b.top - 44) + 'px';
      })
      .on('mouseleave', () => { tip.hidden = true; });
    box.replaceChildren(svg.node(), tip);
  }

  /* ---------- sites and systems ---------- */
  async function loadSites() {
    const [sites, conns] = await Promise.all([
      q(sb.from('solar_sites').select('*').order('sort')),
      q(sb.from('solar_eb_connections').select('*').order('sort')),
    ]);
    return { sites, conns };
  }
  const specText = {
    inverter: (r) => `${r.kw ?? '?'} kW × ${r.count ?? '?'}`,
    panel: (r) => `${r.watt ?? '?'} W × ${r.count ?? '?'}`,
    battery: (r) => `${r.ah != null ? r.ah + ' Ah' : (r.type || 'Battery')}${voltOf(r) ? ' ' + voltOf(r) + ' V' : ''} × ${r.count ?? '?'}${r.ah != null && r.type && r.type !== 'Lead-acid' ? ' ' + r.type.replace(/ 51\.2 V$/, '') : ''}`,
  };
  const voltOf = (r) => r.volt ?? (r.type === 'Lead-acid' ? 12 : r.type === 'Lithium 51.2 V' ? 51.2 : null);
  const cap = (s) => {
    const inv = d3.sum(s.inverter_spec || [], (r) => (r.kw || 0) * (r.count || 0)) || (+s.rated_kw || 0);
    const kwp = d3.sum(s.panel_spec || [], (r) => (r.watt || 0) * (r.count || 0)) / 1000 || (+s.panel_kwp || 0);
    const bat = d3.sum(s.battery_spec || [], (r) => (r.ah || 0) * (voltOf(r) || 0) * (r.count || 0)) / 1000;
    return { inv, kwp, bat, ratio: inv && kwp ? kwp / inv : null };
  };
  const RATIO_HIGH = 1.4;
  const capSum = (list) => list.reduce((a, s) => { const c = cap(s); return { inv: a.inv + c.inv, kwp: a.kwp + c.kwp, bat: a.bat + c.bat }; }, { inv: 0, kwp: 0, bat: 0 });
  const capText = (c) => [c.inv && `${n1(c.inv)} kW inverters`, c.kwp && `${n1(c.kwp)} kWp panels`, c.bat && `${n1(c.bat)} kWh batteries`].filter(Boolean).join(' · ');
  const specLine = (arr, kind) => (arr && arr.length ? arr.map(specText[kind]).join(' + ') : '—');
  const nextSiteId = (name, sites) => {
    let base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'SITE';
    let id = base, k = 2;
    while (sites.some((x) => x.id === id)) id = base + '-' + k++;
    return id;
  };

  const SITE_TYPES = ['Hostel', 'School', 'Office', 'Hotel', 'Residence', 'Shop', 'Construction site'];
  async function sitesPage() {
    const [{ sites, conns }, systemsList, openTasks] = await Promise.all([loadSites(), q(sb.from('solar_system_status').select('*').order('sort')),
      q(sb.from('solar_tickets').select('id, site_id, reason, due').eq('type', 'Task').neq('status', 'Closed').order('due'))]);
    const w = canWrite();
    const t0 = today();
    const card = (site) => {
      const mine = systemsList.filter((x) => x.site_id === site.id);
      const ebs = conns.filter((c) => c.site_id === site.id);
      const cap = mine.length ? capText(capSum(mine.filter((x) => x.tracking !== 'Retired'))) : '';
      const line = (label, items) => h('div', { class: 'sc-line' }, h('span', { class: 'sc-k' }, label), items);
      return h('article', { class: 'site-card', id: 'site-' + site.id },
        h('div', { class: 'sc-head' },
          h('h3', null, h('a', { href: '#site/' + site.id }, site.name)),
          w ? h('button', { class: 'link small', onclick: () => editSite(site, sites) }, 'Edit') : null),
        site.address ? h('p', { class: 'muted sc-addr' }, site.address) : null,
        cap ? h('p', { class: 'site-cap' }, cap) : null,
        line('EB', ebs.length ? h('span', null, ebs.flatMap((c, i) => [i ? h('br') : '', h('span', { class: 'dot ' + (c.tracking === 'Live' ? 'on' : c.tracking === 'Retired' ? 'off' : 'wait'), title: c.tracking === 'Live' ? 'Tracked' : c.tracking }),
          w ? h('button', { class: 'link', onclick: () => editConn(c, site) }, c.label) : c.label,
          h('span', { class: 'muted' }, ` ${c.code}${c.service_no ? ' · ' + c.service_no : ''}${c.incharge ? ' · ' + c.incharge : ''}${c.tracking === 'Live' ? '' : ' · not tracked'}`)])) : h('span', { class: 'due-bad' }, 'none entered')),
        line('Solar', mine.length ? h('span', null, mine.flatMap((x, i) => [i ? ', ' : '', h('button', { class: 'link', onclick: () => editSystem(x) }, x.id),
          h('span', { class: 'muted' }, ' ' + (x.system || x.type || '') + (x.tracking !== 'Live' ? ` · ${x.tracking === 'Pending' ? 'not tracked' : x.tracking.toLowerCase()}` : ''))])) : h('span', { class: 'muted' }, 'none')),
        (() => { const mt = openTasks.filter((t) => t.site_id === site.id); return mt.length ? line('Tasks', h('span', null, mt.flatMap((t, i) => [i ? h('br') : '',
          h('a', { href: '#ticket/' + t.id, class: t.due < t0 ? 'due-bad' : null }, t.reason), h('span', { class: t.due < t0 ? 'due-bad' : 'muted' }, ' · ' + (t.due ? fmtDay(t.due) : 'no date'))]))) : null; })(),
        site.extra_items ? line('Extra', h('span', { class: 'sc-clamp', title: site.extra_items }, site.extra_items)) : null,
        w ? h('div', { class: 'sc-actions' },
          h('button', { class: 'link small', onclick: () => editConn(null, site) }, '+ EB connection'),
          h('button', { class: 'link small', onclick: () => editSystem(null, site.id) }, '+ System'),
          h('button', { class: 'link small', onclick: () => newTask(sites, site.id) }, '+ Task')) : null);
    };
    const types = [...new Set(sites.map((x) => (x.site_type || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const groups = [...types.map((t) => [t, sites.filter((x) => (x.site_type || '').trim() === t)]), ['Type not set', sites.filter((x) => !(x.site_type || '').trim())]]
      .filter(([, list]) => list.length);
    const fleetCap = capSum(systemsList.filter((x) => x.tracking !== 'Retired' && x.tracking !== 'Not installed'));
    main.replaceChildren(pageHead('Sites', `Sites grouped by type. Installed across all sites: ${capText(fleetCap)}.`,
      w ? h('button', { class: 'btn primary', onclick: () => editSite(null, sites) }, 'Add a site') : null),
      ...groups.map(([t, list]) => h('section', null, h('h2', { class: 'grp-title' }, `${t} `, h('span', { class: 'muted' }, `· ${list.length}`)),
        h('div', { class: 'site-cards' }, list.map(card)))));
    const target = location.hash.split('/')[1];
    if (target) { const el = document.getElementById('site-' + target); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
  }

  function editSite(site, sites) {
    const isNew = !site;
    const name = input('si-name', site && site.name, { required: true });
    const known = [...new Set([...SITE_TYPES, ...sites.map((x) => x.site_type).filter(Boolean)])];
    const stype = input('si-type', site && site.site_type, { list: 'si-type-list', placeholder: 'e.g. Hostel, School, Office' });
    const typeList = h('datalist', { id: 'si-type-list' }, known.map((t) => h('option', { value: t })));
    const address = input('si-address', site && site.address);
    const extra = h('textarea', { id: 'si-extra', placeholder: 'Spare panels, spare inverters, batteries in storage…' }, (site && site.extra_items) || '');
    const notes = h('textarea', { id: 'si-notes' }, (site && site.notes) || '');
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const row = { name: name.value.trim(), site_type: stype.value.trim() || null, address: address.value.trim() || null, extra_items: extra.value.trim() || null, notes: notes.value.trim() || null };
      if (isNew) await q(sb.from('solar_sites').insert({ id: nextSiteId(row.name, sites), sort: sites.length + 1, ...row }));
      else await q(sb.from('solar_sites').update(row).eq('id', site.id));
      closeDialog(); toast(isNew ? 'Site added' : 'Site saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, isNew ? 'Add a site' : site.name), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('Site name', name), field('Type of site', stype), typeList, field('Address', address, 'wide'), field('Extra items', extra, 'wide'), field('Notes', notes, 'wide')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save site'))));
  }

  async function editConn(c, site) {
    const isNew = !c;
    const methods = (await q(sb.from('solar_tracking_methods').select('name').order('sort'))).map((m) => m.name);
    const tracking = select('eb-tracking', c ? c.tracking : 'Pending', ['Live', 'Pending', 'Not installed', 'Retired']);
    const via = select('eb-via', c ? c.tracked_via : 'Not tracked yet', methods);
    const device = input('eb-device', c && c.source_id, { placeholder: 'Our logger: site · EB meters, e.g. Hostel 2 · EB 1 + EB 2' });
    const target = input('eb-target', c && c.daylight_target_kwh, { type: 'number', step: 'any', min: 0 });
    const incharge = input('eb-incharge', c && c.incharge, { placeholder: 'Who handles this line' });
    const phone = input('eb-phone', c && c.contact_phone, { type: 'tel' });
    const label = input('eb-label', c ? c.label : site.name, { required: true });
    const service = input('eb-service', c && c.service_no);
    const tariff = input('eb-tariff', c && c.tariff, { placeholder: 'e.g. LT IA, LT CT' });
    const phase = select('eb-phase', c && c.phase, [['', 'Not recorded'], 'Single phase', 'Three phase']);
    const kw = input('eb-kw', c && c.sanctioned_kw, { type: 'number', step: 'any', min: 0 });
    const ct = input('eb-ct', c && c.ct_multiplier, { type: 'number', step: 'any', min: 0 });
    const notes = h('textarea', { id: 'eb-notes' }, (c && c.notes) || '');
    const num = (el) => (el.value === '' ? null : +el.value);
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const row = { label: label.value.trim(), service_no: service.value.trim() || null, tariff: tariff.value.trim() || null, phase: phase.value || null,
        sanctioned_kw: num(kw), ct_multiplier: num(ct), notes: notes.value.trim() || null,
        tracking: tracking.value, tracked_via: via.value, source_id: device.value.trim() || null, daylight_target_kwh: num(target),
        incharge: incharge.value.trim() || null, contact_phone: phone.value.trim() || null };
      if (isNew) await q(sb.from('solar_eb_connections').insert({ site_id: site.id, ...row }));
      else await q(sb.from('solar_eb_connections').update(row).eq('id', c.id));
      closeDialog(); toast('EB connection saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, (isNew ? 'Add an EB connection · ' : `${c.code} · `) + site.name), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('Name', label), field('Consumer number', service), field('Tariff', tariff), field('Phase', phase),
        field('Sanctioned load (kW)', kw), field('Meter CT multiplier', ct), field('In charge', incharge), field('Mobile', phone)),
      h('fieldset', { class: 'spec-set' }, h('legend', null, 'Tracking'),
        h('p', { class: 'muted' }, isNew ? 'A code like E14 is given when you save. The meter logger sends readings under that code.' : `Readings for this line are sent under the code ${c.code}.`),
        h('div', { class: 'form-grid' }, field('Tracking', tracking), field('Tracked via', via), field('Meter or device ID', device), field('Daylight import target (units/day)', target))),
      h('div', { class: 'form-grid' }, field('Notes', notes, 'wide')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  }

  const sysFilter = { q: '', type: '', status: '' };
  async function systems() {
    const [list, { sites }] = await Promise.all([q(sb.from('solar_system_status').select('*').order('sort')), loadSites()]);
    const body = h('div');
    const stat = (label, value, title, cls) => h('div', { class: 'stat' + (cls ? ' ' + cls : ''), title: title || null },
      h('span', { class: 'stat-v' }, value), h('span', { class: 'stat-l' }, label));
    const statusChip = (s) => {
      if (s.tracking !== 'Live') return h('span', { class: 'chip' }, s.tracking === 'Pending' ? 'Not tracked yet' : s.tracking);
      if (!s.attention || s.attention === 'OK' || s.attention === 'Open item') return h('span', { class: 'chip ok' }, 'OK');
      return h('span', { class: 'chip bad' }, s.attention);
    };
    const row = (s) => {
      const c = cap(s);
      const high = c.ratio != null && c.ratio > RATIO_HIGH;
      return h('div', { class: 'sysx' + (s.tracking === 'Live' ? '' : ' dim'), tabindex: 0, role: 'button',
        onclick: () => { location.hash = 'system/' + s.id; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = 'system/' + s.id; } },
        h('div', { class: 'sysx-name' },
          h('div', null, h('span', { class: 'sysx-id' }, s.id), h('strong', null, s.system || s.type || 'Unnamed')),
          h('div', { class: 'muted' }, [s.type, s.tracked_via && s.tracked_via !== 'Not tracked yet' ? 'via ' + s.tracked_via : null].filter(Boolean).join(' · '))),
        h('div', { class: 'sysx-stats' },
          stat('inverter', c.inv ? n1(c.inv) + ' kW' : '—', specLine(s.inverter_spec, 'inverter')),
          stat('panels', c.kwp ? n1(c.kwp) + ' kWp' : '—', specLine(s.panel_spec, 'panel')),
          stat('panel ÷ inverter', c.ratio == null ? '—' : d3.format('.2f')(c.ratio) + '×', high ? 'More panel than the inverter can use; the extra is lost at midday.' : null, high ? 'warn' : null),
          stat('battery', c.bat ? n1(c.bat) + ' kWh' : '—', specLine(s.battery_spec, 'battery'))),
        h('div', { class: 'sysx-exp' }, s.expected_kwh != null ? [h('span', { class: 'stat-v' }, n1(s.expected_kwh)), h('span', { class: 'stat-l' }, 'units / day')] : h('span', { class: 'muted' }, '—')),
        h('div', { class: 'sysx-chip' }, statusChip(s)));
    };
    const matches = (s) => {
      const t = sysFilter.q.trim().toLowerCase();
      if (t && ![s.id, s.system, s.site, s.type, s.tracked_via].join(' ').toLowerCase().includes(t)) return false;
      if (sysFilter.type && s.type !== sysFilter.type) return false;
      if (sysFilter.status === 'attention' && !(s.tracking === 'Live' && s.attention && !['OK', 'Open item'].includes(s.attention))) return false;
      if (sysFilter.status === 'live' && s.tracking !== 'Live') return false;
      if (sysFilter.status === 'notlive' && s.tracking === 'Live') return false;
      return true;
    };
    function draw() {
      const shown = list.filter(matches).filter((x) => x.tracking !== 'Retired' || sysFilter.q);
      const groups = sites.map((site) => ({ site, rows: shown.filter((x) => x.site_id === site.id) })).filter((g) => g.rows.length);
      body.replaceChildren(groups.length ? h('div', { class: 'dg-groups' }, groups.map((g) => h('section', { class: 'panel dg' },
        h('div', { class: 'dg-head' }, h('a', { class: 'tk-site', href: '#site/' + g.site.id }, h('h2', null, g.site.name)), h('span', { class: 'muted' }, String(g.rows.length))),
        h('ul', { class: 'plain dg-list' }, g.rows.map((x) => {
          const bad = x.tracking === 'Live' && isFault(x);
          const lv = x.tracking !== 'Live' ? 'idle' : bad ? 'bad' : 'ok';
          return h('li', null, h('a', { class: 'dg-row', href: '#system/' + x.id }, h('span', { class: 'dot ' + lv }),
            h('span', { class: 'dg-name' }, `${x.id} · ${x.system || x.type || ''}`),
            h('span', { class: 'dg-state ' + lv }, x.tracking !== 'Live' ? (x.tracking === 'Pending' ? 'Not tracked' : x.tracking) : bad ? 'Fault' : 'Working'),
            h('span', { class: 'dg-go', 'aria-hidden': 'true' }, '›')));
        }))))) : h('p', { class: 'empty' }, 'No systems match.'));
    }
    const search = input('sx-q', sysFilter.q, { type: 'search', placeholder: 'Find a system by ID, name or site' });
    search.addEventListener('input', () => { sysFilter.q = search.value; draw(); });
    draw();
    main.replaceChildren(
      h('a', { class: 'back', href: '#setup' }, '← Setup'),
      pageHead('Systems', 'Every solar system, by site. Click one to open it.',
        canWrite() ? h('button', { class: 'btn primary', onclick: () => editSystem(null) }, 'Add a system') : null),
      h('div', { class: 'tk-bar' }, search),
      body);
  }

  // rows of {size, count} with "Add another" — used for inverters, panels and batteries
  function specEditor(id, rows, cols) {
    const box = h('div', { class: 'spec', id });
    const list = h('div', { class: 'spec-rows' });
    const addRow = (r = {}) => {
      const cells = cols.map((c) => {
        const el = c.options ? select(`${id}-${c.key}-${list.children.length}`, r[c.key] ?? c.options[0], c.options)
          : input(`${id}-${c.key}-${list.children.length}`, r[c.key] ?? '', { type: 'number', step: 'any', min: 0, placeholder: c.label });
        el.dataset.key = c.key; el.setAttribute('aria-label', c.label);
        return h('label', { class: 'spec-cell' }, h('span', null, c.label), el);
      });
      const row = h('div', { class: 'spec-row' }, cells, h('button', { type: 'button', class: 'link', onclick: () => row.remove() }, 'Remove'));
      list.append(row);
    };
    (rows && rows.length ? rows : [{}]).forEach(addRow);
    box.append(list, h('button', { type: 'button', class: 'link', onclick: () => addRow() }, 'Add another'));
    box.value = () => [...list.children].map((row) => {
      const o = {};
      row.querySelectorAll('[data-key]').forEach((el) => { const c = cols.find((x) => x.key === el.dataset.key); o[c.key] = c.options ? el.value : (el.value === '' ? null : +el.value); });
      return o;
    }).filter((o) => cols.some((c) => !c.options && o[c.key] != null));
    return box;
  }

  async function editSystem(s, presetSite) {
    const isNew = !s;
    const [{ sites, conns }, methods, all] = await Promise.all([
      loadSites(), q(sb.from('solar_tracking_methods').select('name').order('sort')), q(sb.from('solar_systems').select('id'))]);
    const ro = !canWrite();
    // new systems always get the next number after the highest one in use, never a gap
    const nextId = () => 'S' + String((d3.max(all, (x) => +((x.id.match(/^S(\d+)/) || [])[1] || 0)) || 0) + 1).padStart(2, '0');
    const id = input('sy-id', s ? s.id : nextId(), { required: true, readonly: true, title: 'IDs are given by the app and cannot be changed' });
    id.disabled = true;
    const site = select('sy-site', s ? s.site_id : presetSite || '', [['', 'Choose a site'], ...sites.map((x) => [x.id, x.name])]);
    site.required = true;
    const conn = select('sy-conn', '', [['', 'Not linked']]);
    const fillConns = () => {
      const mine = conns.filter((c) => c.site_id === site.value);
      conn.replaceChildren(...[['', mine.length ? 'Not linked' : 'No EB connections at this site'], ...mine.map((c) => [String(c.id), c.label + (c.service_no ? ' · ' + c.service_no : '')])].map(([v, l]) => h('option', { value: v }, l)));
      conn.value = s && s.eb_connection_id && mine.some((c) => c.id === s.eb_connection_id) ? String(s.eb_connection_id) : '';
    };
    site.addEventListener('change', fillConns); fillConns();
    const system = input('sy-system', s && s.system, { placeholder: 'e.g. 20 kW off-grid, back roof' });
    const type = select('sy-type', s ? s.type || '' : 'Off-grid', ['On-grid', 'Hybrid', 'Off-grid', 'Grid meter']);
    const kw = input('sy-kw', s && s.rated_kw, { type: 'number', step: 'any', min: 0 });
    const tracking = select('sy-tracking', s ? s.tracking : 'Pending', ['Live', 'Pending', 'Not installed', 'Retired']);
    const via = select('sy-via', s ? s.tracked_via : 'Not tracked yet', methods.map((m) => m.name));
    const source = input('sy-source', s && s.source_id, { placeholder: 'Our logger: site · solar meter, e.g. Hostel 2 · Solar 1' });
    const inv = specEditor('sy-inv', s && s.inverter_spec, [{ key: 'kw', label: 'kW each' }, { key: 'count', label: 'Number' }]);
    const pan = specEditor('sy-pan', s && s.panel_spec, [{ key: 'watt', label: 'Watts each' }, { key: 'count', label: 'Number' }]);
    const bat = specEditor('sy-bat', s && s.battery_spec, [{ key: 'ah', label: 'Ah each' }, { key: 'volt', label: 'Volts each' }, { key: 'count', label: 'Number' }, { key: 'type', label: 'Type', options: ['Lead-acid', 'Lithium', 'Lithium 51.2 V', 'Other'] }]);
    const target = input('sy-target', s && s.daylight_target_kwh, { type: 'number', step: 'any', min: 0 });
    const issue = h('textarea', { id: 'sy-issue' }, (s && s.open_issue) || '');
    const question = h('textarea', { id: 'sy-question' }, (s && s.open_question) || '');
    const notes = h('textarea', { id: 'sy-notes' }, (s && s.notes) || '');
    const kwp = h('p', { class: 'muted' });
    const showKwp = () => {
      const c = cap({ inverter_spec: inv.value(), panel_spec: pan.value(), battery_spec: bat.value(), rated_kw: kw.value });
      kwp.textContent = [c.kwp && `Panels add up to ${d3.format(',.2f')(c.kwp)} kWp`, c.ratio && `${d3.format('.2f')(c.ratio)} × the inverter${c.ratio > RATIO_HIGH ? ' (high: it will clip at midday)' : ''}`, c.bat && `batteries store ${n1(c.bat)} kWh`].filter(Boolean).join(' · ');
    };
    [inv, pan, bat, kw].forEach((el) => { el.addEventListener('input', showKwp); el.addEventListener('change', showKwp); el.addEventListener('click', () => setTimeout(showKwp)); }); showKwp();
    const els = [id, site, conn, system, type, kw, tracking, via, source, target, issue, question, notes];
    if (ro) { els.forEach((e) => { e.disabled = true; }); }
    const num = (el) => (el.value === '' ? null : +el.value);
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      if (!site.value) { toast('Choose a site.', true); site.focus(); return; }
      const row = { site_id: site.value, eb_connection_id: conn.value ? +conn.value : null, system: system.value.trim() || null, type: type.value,
        rated_kw: num(kw), tracking: tracking.value, tracked_via: via.value, source_id: source.value.trim() || null,
        inverter_spec: inv.value(), panel_spec: pan.value(), battery_spec: bat.value(), daylight_target_kwh: num(target),
        open_issue: issue.value.trim() || null, open_question: question.value.trim() || null, notes: notes.value.trim() || null };
      const newId = id.value.trim().toUpperCase();
      if (isNew && all.some((x) => x.id.toUpperCase() === newId)) { toast(`${newId} is already used by another system. Pick a different ID.`, true); id.focus(); return; }
      if (isNew) await q(sb.from('solar_systems').insert({ id: newId, sort: all.length + 1, ...row }));
      else await q(sb.from('solar_systems').update(row).eq('id', s.id));
      closeDialog(); toast(isNew ? 'System added' : 'Saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, isNew ? 'Add a system' : `${s.id} · ${s.site}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' },
        field('Site', site), field('ID (given by the app)', id), field('System name', system), field('Type', type),
        field('Rated kW', kw), field('EB connection', conn), field('Tracking', tracking), field('Tracked via', via),
        field('Device or station ID', source)),
      h('fieldset', { class: 'spec-set' }, h('legend', null, 'Inverters'), inv),
      h('fieldset', { class: 'spec-set' }, h('legend', null, 'Panels'), pan, kwp),
      h('fieldset', { class: 'spec-set' }, h('legend', null, 'Batteries'), bat),
      h('div', { class: 'form-grid' }, field('Open issue', issue, 'wide'), field('Open question', question, 'wide'), field('Notes', notes, 'wide')),
      ro ? null : h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Add system' : 'Save'))));
  }

  /* ---------- planned work ---------- */
  async function planned() {
    const [list, sys] = await Promise.all([
      q(sb.from('solar_planned_work').select('*').order('from_date', { ascending: false })),
      q(sb.from('solar_systems').select('id, site, system').order('sort')),
    ]);
    const name = (id) => { const s = sys.find((x) => x.id === id); return s ? `${s.site}${s.system ? ' · ' + s.system : ''}` : id; };
    const sSel = select('pw-sys', '', [['', 'Choose a system'], ...sys.map((s) => [s.id, `${s.id} · ${s.site} ${s.system || ''}`])]);
    const from = input('pw-from', today(), { type: 'date', required: true });
    const to = input('pw-to', today(), { type: 'date', required: true });
    const reason = input('pw-reason', '', { required: true, placeholder: 'Panel cleaning, inverter service…' });
    const add = canWrite() ? h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      if (!sSel.value) { toast('Choose a system.', true); return; }
      await q(sb.from('solar_planned_work').insert({ system_id: sSel.value, from_date: from.value, to_date: to.value, reason: reason.value.trim(), added_by: state.user.id }));
      toast('Planned work added'); route();
    } }, h('h3', null, 'Add planned work'),
      h('div', { class: 'form-grid' }, field('System', sSel), field('From', from), field('To', to), field('Reason', reason)),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add'))) : null;
    const t0 = today();
    main.replaceChildren(pageHead('Planned work', 'While a system has planned work, the nightly checks raise no fault tickets for it.'), add,
      h('section', { class: 'panel' }, list.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['System', 'From', 'To', 'Reason', ''].map((c) => h('th', null, c)))),
        h('tbody', null, list.map((p) => h('tr', null, h('td', null, name(p.system_id)), h('td', null, fmtDate(p.from_date)), h('td', null, fmtDate(p.to_date)),
          h('td', null, p.reason, p.to_date >= t0 && p.from_date <= t0 ? ' ' : null, p.to_date >= t0 && p.from_date <= t0 ? h('span', { class: 'chip amber' }, 'Now') : null),
          h('td', null, canWrite() ? h('button', { class: 'link', onclick: async () => { await q(sb.from('solar_planned_work').delete().eq('id', p.id)); toast('Removed'); route(); } }, 'Remove') : null))))))
        : h('p', { class: 'empty' }, 'No planned work.')));
  }

  /* ---------- settings ---------- */
  async function settings() {
    const list = await q(sb.from('solar_settings').select('*').order('sort'));
    const els = {};
    const form = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      for (const s of list) if (els[s.key].value !== s.value) await q(sb.from('solar_settings').update({ value: els[s.key].value.trim() }).eq('key', s.key));
      toast('Settings saved'); boot();
    } }, h('div', { class: 'form-grid' }, list.map((s) => {
      els[s.key] = input('st-' + s.key, s.value, { disabled: !canWrite() });
      return h('div', { class: 'field' }, h('label', { for: 'st-' + s.key }, s.label), els[s.key], h('span', { class: 'muted', style: 'font-size:.82rem' }, s.description || ''));
    })), canWrite() ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')) : null);
    main.replaceChildren(pageHead('Settings', 'The rules behind the nightly checks.'), form);
  }

  /* ---------- users ---------- */
  async function users() {
    const list = await q(sb.rpc('solar_list_users'));
    const login = input('us-login', '', { required: true, placeholder: 'e.g. admin' });
    const nm = input('us-name', '', { required: true });
    const role = select('us-role', 'admin', [['admin', 'Admin'], ['owner', 'Owner'], ['viewer', 'Viewer (read only)']]);
    const add = isOwner() ? h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const r = await q(sb.rpc('solar_add_user', { p_login: login.value, p_name: nm.value.trim(), p_role: role.value }));
      toast('Added ' + r); route();
    } }, h('h3', null, 'Give a login access'),
      h('p', { class: 'muted' }, `First create the login in Supabase under Authentication, Users, Add user. Use username@${cfg.loginDomain} as the email and tick Auto confirm. Then add it here.`),
      h('div', { class: 'form-grid' }, field('Username', login), field('Name', nm), field('Role', role)),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Give access'))) : null;
    main.replaceChildren(pageHead('Users', 'Who can sign in to Solar Fleet.'), add,
      h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Name', 'Username', 'Role'].map((c) => h('th', null, c)))),
        h('tbody', null, list.map((u) => h('tr', null, h('td', null, u.name), h('td', null, u.login), h('td', null, u.role))))))));
  }

  /* ---------- all sites in one table ---------- */
  const siteTableState = { q: '', type: '', sort: 'name', dir: 1 };
  async function siteTable() {
    const [{ sites, conns }, systemsList, billsAll, open] = await Promise.all([
      loadSites(),
      q(sb.from('solar_system_status').select('*').order('sort')),
      q(sb.from('solar_eb_bills').select('*')
        .order('period_to', { ascending: false, nullsFirst: false })),
      q(sb.from('solar_tickets').select('id, site_id, type, due, reason').neq('status', 'Closed')),
    ]);
    const t0 = today();
    const units = (b) => (b ? +(b.billed_kwh ?? b.import_kwh) : null);
    const rows = sites.map((site) => {
      const lines = conns.filter((c) => c.site_id === site.id && c.tracking !== 'Retired');
      const sys = systemsList.filter((x) => x.site_id === site.id && x.tracking !== 'Retired');
      const bills = billsAll.filter((b) => b.site_id === site.id).slice(0, 3);
      const c = capSum(sys);
      const mine = open.filter((t) => t.site_id === site.id);
      const change = bills[0] && bills[1] && units(bills[1]) ? Math.round(((units(bills[0]) - units(bills[1])) / units(bills[1])) * 100) : null;
      const problems = sys.filter((x) => x.tracking === 'Live' && x.attention && !['OK', 'Open item'].includes(x.attention));
      return { site, lines, sys, bills, c, change, problems,
        tickets: mine.filter((t) => t.type !== 'Task' && t.type !== 'Setup'), tasks: mine.filter((t) => t.type === 'Task'),
        overdue: mine.filter((t) => t.due && t.due < t0 && t.type !== 'Setup').length };
    });
    const sorters = {
      name: (r) => r.site.name.toLowerCase(), type: (r) => (r.site.site_type || 'zzz').toLowerCase(),
      sanctioned: (r) => d3.sum(r.lines, (l) => +l.sanctioned_kw || 0), solar: (r) => r.c.kwp,
      bill: (r) => (r.bills[0] ? +r.bills[0].amount : -1), units: (r) => (r.bills[0] ? units(r.bills[0]) : -1),
      change: (r) => (r.change == null ? -1e9 : r.change), open: (r) => r.tickets.length + r.tasks.length,
    };
    const body = h('div', { class: 'table-wrap' });
    const fmtBill = (b) => b ? h('button', { class: 'bill-mini' + (b.status === 'Submitted' ? ' wait' : b.status === 'Rejected' ? ' bad' : ''), onclick: () => billDetail(b),
      title: b.status === 'Submitted' ? 'Awaiting approval' : b.status },
      h('span', { class: 'd' }, d3.utcFormat('%b %y')(new Date(b.period_to || b.bill_date)) + (isUnpaid(b) ? ' · unpaid' : '')),
      h('span', { class: 'u' }, n0(units(b)) + ' u'), h('span', { class: 'a' }, b.amount == null ? '' : '₹' + d3.format(',.0f')(b.amount))) : h('span', { class: 'muted' }, '—');
    const cols = [
      ['Site', 'name'], ['Type', 'type'], ['Consumer no.', null], ['Sanctioned', 'sanctioned'], ['In charge', null], ['Solar', 'solar'],
      ['Latest bill', 'bill'], ['Bill before', null], ['Bill before that', null], ['Units vs last', 'change'], ['Open', 'open'],
    ];
    function draw() {
      const qq = siteTableState.q.trim().toLowerCase();
      let list = rows.filter((r) => (!siteTableState.type || (r.site.site_type || '') === siteTableState.type)
        && (!qq || [r.site.name, r.site.site_type, ...r.lines.map((l) => `${l.service_no} ${l.incharge} ${l.contact_phone}`), ...r.sys.map((x) => x.id)].join(' ').toLowerCase().includes(qq)));
      const key = sorters[siteTableState.sort];
      list = list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * siteTableState.dir; });
      const head = h('tr', null, cols.map(([label, k]) => h('th', { class: (['sanctioned', 'change', 'open'].includes(k) ? 'n ' : '') + (k ? 'sortable' : ''),
        onclick: k ? () => { siteTableState.dir = siteTableState.sort === k ? -siteTableState.dir : (['name', 'type'].includes(k) ? 1 : -1); siteTableState.sort = k; draw(); } : null },
        label, k && siteTableState.sort === k ? (siteTableState.dir > 0 ? ' ▲' : ' ▼') : '')));
      const totalLatest = d3.sum(list, (r) => (r.bills[0] ? +r.bills[0].amount : 0));
      body.replaceChildren(h('table', { class: 'site-table' },
        h('thead', null, head),
        h('tbody', null, list.map((r) => h('tr', null,
          h('td', { class: 'st-name' }, h('a', { href: '#site/' + r.site.id }, r.site.name),
            r.problems.length ? h('div', { class: 'due-bad small' }, r.problems.map((x) => `${x.id}: ${x.attention}`).join('; ')) : null),
          h('td', null, r.site.site_type || h('span', { class: 'muted' }, '—')),
          h('td', { class: 'nw' }, r.lines.length ? r.lines.flatMap((l, i) => [i ? h('br') : '', l.service_no || h('span', { class: 'due-bad' }, 'missing')]) : h('span', { class: 'muted' }, 'no EB line')),
          h('td', { class: 'n nw' }, r.lines.length ? r.lines.flatMap((l, i) => [i ? h('br') : '', l.sanctioned_kw != null ? l.sanctioned_kw + ' kW' : '—']) : '—'),
          h('td', null, r.lines.flatMap((l, i) => [i ? h('br') : '', [l.incharge, l.contact_phone].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—')])),
          h('td', { class: 'st-solar' }, r.sys.length ? [
            ...[r.c.inv && n0(r.c.inv) + ' kW inverter', r.c.kwp && n1(r.c.kwp) + ' kWp panels', r.c.bat && n0(r.c.bat) + ' kWh battery'].filter(Boolean).map((t) => h('div', { class: 'nw' }, t)),
            h('div', { class: 'muted small nw' }, `${r.sys.filter((x) => x.tracking === 'Live').length} of ${r.sys.length} tracked`)] : h('span', { class: 'muted' }, 'none')),
          h('td', null, fmtBill(r.bills[0])), h('td', null, fmtBill(r.bills[1])), h('td', null, fmtBill(r.bills[2])),
          h('td', { class: 'n ' + (r.change > 15 ? 'due-bad' : r.change < -15 ? 'good' : '') }, r.change == null ? '—' : (r.change > 0 ? '+' : '') + r.change + '%'),
          h('td', { class: 'n nw' }, r.tickets.length || r.tasks.length ? h('a', { href: '#tickets' }, [r.tickets.length && `${r.tickets.length} ticket${r.tickets.length > 1 ? 's' : ''}`, r.tasks.length && `${r.tasks.length} task${r.tasks.length > 1 ? 's' : ''}`].filter(Boolean).join(', '))
            : h('span', { class: 'muted' }, '—'), r.overdue ? h('div', { class: 'due-bad small' }, `${r.overdue} overdue`) : null)))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 6 }, `${list.length} sites`), h('td', null, h('strong', null, '₹' + d3.format(',.0f')(totalLatest)), h('div', { class: 'muted small' }, 'latest bills, total')), h('td', { colspan: 4 })))));
    }
    const search = input('st-q', siteTableState.q, { type: 'search', placeholder: 'Site, consumer no., person or system ID' });
    search.addEventListener('input', () => { siteTableState.q = search.value; draw(); });
    const types = [...new Set(sites.map((x) => x.site_type).filter(Boolean))].sort();
    const type = select('st-type', siteTableState.type, [['', 'All types'], ...types.map((t) => [t, t])]);
    type.addEventListener('change', () => { siteTableState.type = type.value; draw(); });
    const exportXlsx = async () => {
      try {
        await loadXlsx();
        const head = ['Site', 'Type', 'Consumer no.', 'Sanctioned kW', 'In charge', 'Mobile', 'Inverter kW', 'Panel kWp', 'Battery kWh', 'Systems', 'Tracked',
          'Bill 1 period to', 'Bill 1 units', 'Bill 1 amount', 'Bill 2 period to', 'Bill 2 units', 'Bill 2 amount', 'Bill 3 period to', 'Bill 3 units', 'Bill 3 amount', 'Open tickets', 'Open tasks'];
        const out = rows.map((r) => {
          const b = (i) => (r.bills[i] ? [r.bills[i].period_to || r.bills[i].bill_date, units(r.bills[i]), +r.bills[i].amount] : ['', '', '']);
          return [r.site.name, r.site.site_type || '', r.lines.map((l) => l.service_no).filter(Boolean).join(', '), d3.sum(r.lines, (l) => +l.sanctioned_kw || 0) || '',
            r.lines.map((l) => l.incharge).filter(Boolean).join(', '), r.lines.map((l) => l.contact_phone).filter(Boolean).join(', '),
            r.c.inv || '', r.c.kwp || '', r.c.bat || '', r.sys.length, r.sys.filter((x) => x.tracking === 'Live').length, ...b(0), ...b(1), ...b(2), r.tickets.length, r.tasks.length];
        });
        const ws = XLSX.utils.aoa_to_sheet([head, ...out]);
        // keep consumer numbers as text so the leading 0 is not lost
        out.forEach((_, i) => { const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: 2 })]; if (cell) { cell.t = 's'; cell.z = '@'; } });
        ws['!cols'] = head.map((x, i) => ({ wch: i === 0 ? 30 : i === 2 ? 16 : 13 }));
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sites');
        XLSX.writeFile(wb, `solar-fleet-sites-${today()}.xlsx`);
      } catch (err) { toast(err.message || 'Could not make the file', true); }
    };
    draw();
    main.replaceChildren(
      pageHead('Site table', 'Every site on one line with its EB details, solar and its last three bills. Click a column heading to sort, a bill to open it.',
        h('button', { class: 'btn', onclick: exportXlsx }, 'Download as Excel')),
      h('div', { class: 'filters' }, field('Search', search), field('Type', type)),
      h('section', { class: 'panel' }, body));
  }

  /* ---------- bulk upload from Excel ---------- */
  const BULK_SHEETS = {
    'Sites': ['Site ID', 'Site name', 'Type of site', 'Address', 'Extra items', 'Notes'],
    'EB connections': ['Site name', 'Connection name', 'Service number', 'Tariff', 'Phase', 'Sanctioned kW', 'CT multiplier', 'Tracking', 'Tracked via', 'Device ID', 'Daylight target kWh', 'Notes'],
    'Systems': ['System ID', 'Site name', 'System name', 'Type', 'Rated kW', 'Tracking', 'Tracked via', 'Device ID', 'EB connection',
      'Inverter kW each', 'Inverters', 'Panel watts each', 'Panels', 'Battery Ah', 'Battery volts', 'Batteries', 'Battery type', 'Daylight target kWh', 'Notes'],
    'Tasks': ['Site name', 'Task', 'Details', 'Due date', 'Assigned to'],
  };
  const SYS_TYPES = ['On-grid', 'Hybrid', 'Off-grid', 'Grid meter'];
  const TRACKING = ['Live', 'Pending', 'Not installed', 'Retired'];
  const BULK_HELP = [
    ['How to use this file'],
    ['Fill in only the tabs you need. Empty tabs are ignored. Keep the headings in row 1 exactly as they are.'],
    ['Upload it on the Bulk upload page. You will see what will be added or changed before anything is saved.'],
    [''],
    ['Sites', 'Leave Site ID blank for a new site. A row whose Site ID or Site name matches an existing site updates that site.'],
    ['EB connections', 'Site name must match a site in the app or on the Sites tab. A connection with the same name at the same site is updated.'],
    ['', 'Set Tracking to Live once its smart meter is sending readings. New connections get a code like E14, shown in the app.'],
    ['Systems', 'Leave System ID blank for a new system; the app gives it the next free ID. You cannot pick your own ID. Type: ' + SYS_TYPES.join(', ') + '. Tracking: ' + TRACKING.join(', ') + '.'],
    ['', 'A system with two kinds of panel, inverter or battery: add a second row with the same System ID and fill only those columns.'],
    ['', 'EB connection is the connection name at that site. Battery volts: 12 for a lead-acid battery, 51.2 for a 51.2 V lithium pack.'],
    ['Tasks', 'Every row becomes a new open task. Due date is required (for example 15/11/2026). The same task, site and date is not added twice.'],
    [''],
    ['Blank cells', 'When updating, a blank cell leaves the current value as it is. To clear a value, edit it in the app.'],
  ];

  async function loadXlsx() {
    if (window.XLSX) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/xlsx-0.18.5.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader. Check your connection and try again.'));
      document.head.append(s);
    });
  }

  async function bulkCurrent() {
    const [{ sites, conns }, systemsList, methods] = await Promise.all([loadSites(),
      q(sb.from('solar_systems').select('*').order('sort')), q(sb.from('solar_tracking_methods').select('name').order('sort'))]);
    return { sites, conns, systems: systemsList, methods: methods.map((m) => m.name) };
  }

  function bulkWorkbook(cur) {
    const wb = XLSX.utils.book_new();
    const add = (name, rows, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add('How to use', BULK_HELP, [16, 120]);
    const siteName = (id) => (cur && cur.sites.find((x) => x.id === id) || {}).name || '';
    add('Sites', [BULK_SHEETS.Sites, ...(cur ? cur.sites.map((x) => [x.id, x.name, x.site_type || '', x.address || '', x.extra_items || '', x.notes || '']) : [])], [18, 30, 16, 30, 40, 40]);
    add('EB connections', [BULK_SHEETS['EB connections'], ...(cur ? cur.conns.map((c) => [siteName(c.site_id), c.label, c.service_no || '', c.tariff || '', c.phase || '',
      c.sanctioned_kw ?? '', c.ct_multiplier ?? '', c.tracking, c.tracked_via, c.source_id || '', c.daylight_target_kwh ?? '', c.notes || '']) : [])], [30, 28, 18, 12, 14, 14, 14, 13, 20, 18, 12, 30]);
    const sysRows = [];
    if (cur) cur.systems.forEach((s) => {
      const inv = s.inverter_spec || [], pan = s.panel_spec || [], bat = s.battery_spec || [];
      const n = Math.max(1, inv.length, pan.length, bat.length);
      const conn = cur.conns.find((c) => c.id === s.eb_connection_id);
      for (let i = 0; i < n; i++) {
        const iv = inv[i] || {}, pv = pan[i] || {}, bv = bat[i] || {};
        sysRows.push(i === 0
          ? [s.id, siteName(s.site_id), s.system || '', s.type || '', s.rated_kw ?? '', s.tracking, s.tracked_via || '', s.source_id || '', conn ? conn.label : '',
            iv.kw ?? '', iv.count ?? '', pv.watt ?? '', pv.count ?? '', bv.ah ?? '', bv.volt ?? '', bv.count ?? '', bv.type || '', s.daylight_target_kwh ?? '', s.notes || '']
          : [s.id, '', '', '', '', '', '', '', '', iv.kw ?? '', iv.count ?? '', pv.watt ?? '', pv.count ?? '', bv.ah ?? '', bv.volt ?? '', bv.count ?? '', bv.type || '', '', '']);
      }
    });
    add('Systems', [BULK_SHEETS.Systems, ...sysRows], [10, 28, 24, 11, 9, 13, 20, 18, 22, 10, 9, 10, 8, 9, 9, 9, 15, 12, 30]);
    add('Tasks', [BULK_SHEETS.Tasks], [30, 40, 40, 14, 18]);
    return wb;
  }

  // Build a plan from the uploaded file without saving anything.
  function bulkPlan(wb, cur) {
    const errors = [], plan = { sites: [], conns: [], systems: [], tasks: [] };
    const low = (v) => String(v ?? '').trim().toLowerCase();
    const str = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
    const num = (v, where) => {
      if (v === '' || v == null) return null;
      const n = typeof v === 'number' ? v : +String(v).replace(/,/g, '').trim();
      if (!isFinite(n)) { errors.push(`${where}: "${v}" is not a number.`); return null; }
      return n;
    };
    const rowsOf = (name) => {
      const ws = wb.Sheets[name]; if (!ws) return [];
      return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
        .map((r, i) => { const o = { _row: i + 2 }; Object.keys(r).forEach((k) => { o[k.trim()] = typeof r[k] === 'string' ? r[k].trim() : r[k]; }); return o; })
        .filter((r) => BULK_SHEETS[name].some((k) => r[k] !== '' && r[k] != null));
    };
    const known = Object.keys(BULK_SHEETS).filter((n) => wb.Sheets[n]);
    if (!known.length) errors.push('None of the tabs Sites, EB connections, Systems or Tasks were found. Use the template from this page.');
    known.forEach((n) => {
      const head = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 })[0] || []).map((x) => String(x).trim());
      const optional = ['Tracking', 'Tracked via', 'Device ID', 'Daylight target kWh'];
      const missing = BULK_SHEETS[n].filter((k) => !head.includes(k) && !(n === 'EB connections' && optional.includes(k)));
      if (missing.length) errors.push(`${n} tab: missing heading${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`);
    });

    // sites: name -> id, including new ones from this file
    const siteByName = new Map(cur.sites.map((x) => [low(x.name), x]));
    const siteIds = new Set(cur.sites.map((x) => x.id));
    let sort = d3.max(cur.sites, (x) => x.sort) || 0;
    rowsOf('Sites').forEach((r) => {
      const where = `Sites row ${r._row}`;
      const name = str(r['Site name']);
      if (!name) { errors.push(`${where}: Site name is empty.`); return; }
      let existing = r['Site ID'] ? cur.sites.find((x) => low(x.id) === low(r['Site ID'])) : null;
      if (r['Site ID'] && !existing) { errors.push(`${where}: Site ID "${r['Site ID']}" is not in the app. Leave it blank for a new site.`); return; }
      existing = existing || siteByName.get(low(name));
      const clash = siteByName.get(low(name));
      if (clash && existing && clash.id !== existing.id) { errors.push(`${where}: another site is already called "${name}".`); return; }
      const fields = { name, site_type: str(r['Type of site']), address: str(r['Address']), extra_items: str(r['Extra items']), notes: str(r['Notes']) };
      if (existing) {
        const upd = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && v !== existing[k]));
        plan.sites.push({ kind: Object.keys(upd).length ? 'update' : 'same', id: existing.id, row: upd, label: name });
        siteByName.set(low(name), { ...existing, name });
      } else {
        const id = nextSiteId(name, [...siteIds].map((x) => ({ id: x })));
        siteIds.add(id);
        const row = { id, sort: ++sort, ...fields };
        plan.sites.push({ kind: 'new', id, row, label: name });
        siteByName.set(low(name), row);
      }
    });
    const findSite = (v, where) => {
      if (!str(v)) { errors.push(`${where}: Site name is empty.`); return null; }
      const s = siteByName.get(low(v));
      if (!s) errors.push(`${where}: no site called "${v}". Add it on the Sites tab or check the spelling.`);
      return s || null;
    };

    // EB connections, keyed by site id + name
    const connKey = (siteId, label) => siteId + '|' + low(label);
    const conns = new Map(cur.conns.map((c) => [connKey(c.site_id, c.label), c]));
    rowsOf('EB connections').forEach((r) => {
      const where = `EB connections row ${r._row}`;
      const site = findSite(r['Site name'], where); if (!site) return;
      const label = str(r['Connection name']);
      if (!label) { errors.push(`${where}: Connection name is empty.`); return; }
      let phase = str(r['Phase']);
      if (phase) { phase = /^s|1/i.test(phase) ? 'Single phase' : /^t|3/i.test(phase) ? 'Three phase' : (errors.push(`${where}: Phase should be Single phase or Three phase.`), null); }
      const fields = { label, service_no: str(r['Service number']), tariff: str(r['Tariff']), phase,
        sanctioned_kw: num(r['Sanctioned kW'], where), ct_multiplier: num(r['CT multiplier'], where), notes: str(r['Notes']),
        source_id: str(r['Device ID']), daylight_target_kwh: num(r['Daylight target kWh'], where) };
      const tr = str(r['Tracking']), tv = str(r['Tracked via']);
      if (tr) { const ok = TRACKING.find((t) => low(t) === low(tr)); if (ok) fields.tracking = ok; else errors.push(`${where}: Tracking should be one of ${TRACKING.join(', ')}.`); }
      if (tv) { const ok = cur.methods.find((m) => low(m) === low(tv)); if (ok) fields.tracked_via = ok; else errors.push(`${where}: Tracked via should be one of ${cur.methods.join(', ')}.`); }
      const ex = conns.get(connKey(site.id, label));
      if (ex && ex.id) {
        const upd = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && String(v) !== String(ex[k] ?? '')));
        plan.conns.push({ kind: Object.keys(upd).length ? 'update' : 'same', id: ex.id, row: upd, label: `${site.name} · ${label}` });
      } else if (ex) {
        errors.push(`${where}: "${label}" appears twice for ${site.name}.`);
      } else {
        plan.conns.push({ kind: 'new', row: { site_id: site.id, ...fields }, label: `${site.name} · ${label}` });
        conns.set(connKey(site.id, label), { site_id: site.id, label });
      }
    });

    // systems: rows grouped by System ID; blank ID = new system
    const methodBy = new Map(cur.methods.map((m) => [low(m), m]));
    const usedIds = new Set(cur.systems.map((x) => x.id));
    const nextSys = () => { const top = Math.max(0, ...[...usedIds].map((x) => +((x.match(/^S(\d+)/) || [])[1] || 0))); const id = 'S' + String(top + 1).padStart(2, '0'); usedIds.add(id); return id; };
    const groups = [];
    rowsOf('Systems').forEach((r) => {
      const id = str(r['System ID']) && String(r['System ID']).trim().toUpperCase();
      const g = id && groups.find((x) => x.id === id);
      if (g) g.rows.push(r); else groups.push({ id, rows: [r] });
    });
    groups.forEach((g) => {
      const r = g.rows[0], where = `Systems row ${r._row}`;
      const existing = g.id ? cur.systems.find((x) => x.id === g.id) : null;
      const siteCell = str(r['Site name']);
      const site = siteCell ? findSite(siteCell, where) : existing ? cur.sites.find((x) => x.id === existing.site_id) : findSite('', where);
      if (!site) return;
      const type = str(r['Type']);
      const typeOk = type ? SYS_TYPES.find((t) => low(t) === low(type)) : null;
      if (type && !typeOk) errors.push(`${where}: Type should be one of ${SYS_TYPES.join(', ')}.`);
      const tracking = str(r['Tracking']);
      const trackOk = tracking ? TRACKING.find((t) => low(t) === low(tracking)) : null;
      if (tracking && !trackOk) errors.push(`${where}: Tracking should be one of ${TRACKING.join(', ')}.`);
      const via = str(r['Tracked via']);
      const viaOk = via ? methodBy.get(low(via)) : null;
      if (via && !viaOk) errors.push(`${where}: Tracked via should be one of ${cur.methods.join(', ')}.`);
      let connId;
      const connName = str(r['EB connection']);
      if (connName) {
        const c = conns.get(connKey(site.id, connName));
        if (!c) errors.push(`${where}: no EB connection called "${connName}" at ${site.name}.`);
        else connId = { site_id: site.id, label: c.label };
      }
      const spec = { inv: [], pan: [], bat: [] };
      g.rows.forEach((x) => {
        const w = `Systems row ${x._row}`;
        const ik = num(x['Inverter kW each'], w), ic = num(x['Inverters'], w);
        if (ik != null || ic != null) spec.inv.push({ kw: ik, count: ic ?? 1 });
        const pw = num(x['Panel watts each'], w), pc = num(x['Panels'], w);
        if (pw != null || pc != null) spec.pan.push({ watt: pw, count: pc });
        const ba = num(x['Battery Ah'], w), bv = num(x['Battery volts'], w), bc = num(x['Batteries'], w), bt = str(x['Battery type']);
        if (ba != null || bc != null || bv != null) spec.bat.push({ ah: ba, volt: bv ?? (bt && /51/.test(bt) ? 51.2 : bt && /lead/i.test(bt) ? 12 : null), count: bc, type: bt || 'Lead-acid' });
      });
      const fields = { site_id: site.id, system: str(r['System name']), type: typeOk, rated_kw: num(r['Rated kW'], where), tracking: trackOk, tracked_via: viaOk,
        source_id: str(r['Device ID']), daylight_target_kwh: num(r['Daylight target kWh'], where), notes: str(r['Notes']) };
      if (spec.inv.length) fields.inverter_spec = spec.inv;
      if (spec.pan.length) fields.panel_spec = spec.pan;
      if (spec.bat.length) fields.battery_spec = spec.bat;
      if (existing) {
        const upd = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && JSON.stringify(v) !== JSON.stringify(existing[k] ?? null)));
        plan.systems.push({ kind: Object.keys(upd).length || connId ? 'update' : 'same', id: existing.id, row: upd, conn: connId, label: `${existing.id} · ${site.name}` });
      } else {
        if (g.id) { errors.push(`${where}: there is no system ${g.id}. Leave System ID blank for a new system; the app gives it the next ID.`); return; }
        const id = nextSys();
        plan.systems.push({ kind: 'new', id, conn: connId, label: `${id} · ${site.name}`,
          row: { id, sort: usedIds.size, inverter_spec: [], panel_spec: [], battery_spec: [], ...fields, tracking: trackOk || 'Pending', tracked_via: viaOk || 'Not tracked yet', type: typeOk || 'Off-grid' } });
      }
    });

    // tasks
    const toDate = (v) => {
      if (v instanceof Date) return d3.timeFormat('%Y-%m-%d')(v);
      if (typeof v === 'number') return d3.utcFormat('%Y-%m-%d')(new Date(Math.round((v - 25569) * 864e5)));
      const s = String(v).trim();
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return null;
    };
    rowsOf('Tasks').forEach((r) => {
      const where = `Tasks row ${r._row}`;
      const site = findSite(r['Site name'], where);
      const reason = str(r['Task']);
      if (!reason) errors.push(`${where}: Task is empty.`);
      const due = r['Due date'] === '' ? null : toDate(r['Due date']);
      if (!due) errors.push(`${where}: Due date is missing or not a date (use 15/11/2026).`);
      if (!site || !reason || !due) return;
      const dup = (cur.tasks || []).some((t) => t.site_id === site.id && low(t.reason) === low(reason) && t.due === due);
      plan.tasks.push({ kind: dup ? 'same' : 'new', label: `${site.name} · ${reason} · ${fmtDay(due)}`,
        row: { type: 'Task', site_id: site.id, site: site.name, reason, details: str(r['Details']), due, assigned_to: str(r['Assigned to']) } });
    });
    return { plan, errors };
  }

  async function bulkApply(plan) {
    const done = { sites: 0, conns: 0, systems: 0, tasks: 0 };
    const news = (list) => list.filter((x) => x.kind === 'new');
    const upds = (list) => list.filter((x) => x.kind === 'update');
    if (news(plan.sites).length) await q(sb.from('solar_sites').insert(news(plan.sites).map((x) => x.row)));
    for (const x of upds(plan.sites)) await q(sb.from('solar_sites').update(x.row).eq('id', x.id));
    done.sites = news(plan.sites).length + upds(plan.sites).length;
    if (news(plan.conns).length) await q(sb.from('solar_eb_connections').insert(news(plan.conns).map((x) => x.row)));
    for (const x of upds(plan.conns)) await q(sb.from('solar_eb_connections').update(x.row).eq('id', x.id));
    done.conns = news(plan.conns).length + upds(plan.conns).length;
    const conns = await q(sb.from('solar_eb_connections').select('id, site_id, label'));
    const connId = (c) => { if (!c) return undefined; const m = conns.find((x) => x.site_id === c.site_id && x.label.toLowerCase() === c.label.toLowerCase()); return m ? m.id : undefined; };
    const newSys = news(plan.systems).map((x) => { const id = connId(x.conn); return id ? { ...x.row, eb_connection_id: id } : x.row; });
    if (newSys.length) await q(sb.from('solar_systems').insert(newSys));
    for (const x of upds(plan.systems)) { const id = connId(x.conn); await q(sb.from('solar_systems').update(id ? { ...x.row, eb_connection_id: id } : x.row).eq('id', x.id)); }
    done.systems = newSys.length + upds(plan.systems).length;
    if (news(plan.tasks).length) await q(sb.from('solar_tickets').insert(news(plan.tasks).map((x) => x.row)));
    done.tasks = news(plan.tasks).length;
    return done;
  }

  async function bulk() {
    const w = canWrite();
    const status = h('div');
    const download = async (withData) => {
      try {
        await loadXlsx();
        const wb = bulkWorkbook(withData ? await bulkCurrent() : null);
        XLSX.writeFile(wb, withData ? `solar-fleet-${today()}.xlsx` : 'solar-fleet-template.xlsx');
      } catch (err) { toast(err.message || 'Could not make the file', true); }
    };
    const file = input('bk-file', '', { type: 'file', accept: '.xlsx,.xls,.csv' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      status.replaceChildren(h('p', { class: 'muted' }, 'Reading ' + f.name + '…'));
      try {
        await loadXlsx();
        const [wb, cur, tasks] = await Promise.all([f.arrayBuffer().then((b) => XLSX.read(b, { cellDates: true })), bulkCurrent(),
          q(sb.from('solar_tickets').select('site_id, reason, due').eq('type', 'Task').neq('status', 'Closed'))]);
        cur.tasks = tasks;
        const { plan, errors } = bulkPlan(wb, cur);
        showPlan(f.name, plan, errors);
      } catch (err) { status.replaceChildren(h('p', { class: 'due-bad' }, err.message || 'Could not read that file.')); }
    });
    function showPlan(name, plan, errors) {
      const parts = [['sites', 'Sites'], ['conns', 'EB connections'], ['systems', 'Systems'], ['tasks', 'Tasks']];
      const count = (k, kind) => plan[k].filter((x) => x.kind === kind).length;
      const total = parts.reduce((a, [k]) => a + count(k, 'new') + count(k, 'update'), 0);
      const go = h('button', { class: 'btn primary', disabled: !!errors.length || !total }, total ? `Save ${total} change${total > 1 ? 's' : ''}` : 'Nothing to change');
      go.addEventListener('click', async () => {
        go.disabled = true; go.textContent = 'Saving…';
        try {
          const d = await bulkApply(plan);
          status.replaceChildren(h('div', { class: 'panel' }, h('h3', null, 'Saved'),
            h('p', null, `${d.sites} sites, ${d.conns} EB connections, ${d.systems} systems and ${d.tasks} tasks were added or updated.`)));
          file.value = ''; refreshCounts(); toast('Bulk upload saved');
        } catch (err) { toast(err.message || 'Saving stopped part way. Download the current data to see what was saved.', true); go.disabled = false; go.textContent = 'Try again'; }
      });
      const detail = (k) => {
        const rows = plan[k].filter((x) => x.kind !== 'same');
        return rows.length ? h('ul', { class: 'plain bulk-list' }, rows.slice(0, 60).map((x) => h('li', null,
          h('span', { class: 'chip ' + (x.kind === 'new' ? 'ok' : 'amber') }, x.kind === 'new' ? 'New' : 'Update'), ' ', x.label,
          x.kind === 'update' ? h('span', { class: 'muted' }, ' · ' + Object.keys(x.row).concat(x.conn ? ['EB connection'] : []).map((f) => f.replace(/_/g, ' ').replace(' spec', 's')).join(', ')) : null)),
          rows.length > 60 ? h('li', { class: 'muted' }, `and ${rows.length - 60} more`) : null) : null;
      };
      status.replaceChildren(h('div', { class: 'panel' },
        h('h3', null, name),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['', 'New', 'Updated', 'No change'].map((c, i) => h('th', { class: i ? 'n' : null }, c)))),
          h('tbody', null, parts.map(([k, l]) => h('tr', null, h('td', null, l), h('td', { class: 'n' }, count(k, 'new')), h('td', { class: 'n' }, count(k, 'update')), h('td', { class: 'n' }, count(k, 'same'))))))),
        errors.length ? h('div', { class: 'bulk-errors' }, h('h3', null, `Fix ${errors.length === 1 ? 'this' : 'these ' + errors.length} in the file, then upload it again`),
          h('ul', null, errors.slice(0, 50).map((e) => h('li', null, e)))) : null,
        ...parts.map(([k, l]) => { const d = detail(k); return d ? h('div', null, h('h3', null, l), d) : null; }).filter(Boolean),
        w ? h('div', { class: 'actions' }, go) : null));
    }
    main.replaceChildren(
      pageHead('Bulk upload', 'Add or update sites, EB connections, systems and tasks from one Excel file. Nothing is saved until you check the summary and press Save.'),
      h('section', { class: 'panel' },
        h('h3', null, '1. Get the template'),
        h('p', { class: 'muted' }, 'The current-data file has everything already in the app, so you can edit it and upload it back. The blank one only has the headings.'),
        h('div', { class: 'actions left' },
          h('button', { class: 'btn', onclick: () => download(true) }, 'Download with current data'),
          h('button', { class: 'btn', onclick: () => download(false) }, 'Download blank template'))),
      w ? h('section', { class: 'panel' }, h('h3', null, '2. Upload the filled file'), field('Excel file', file)) : h('p', { class: 'muted' }, 'Only the owner and admin can upload.'),
      status);
  }

  // Reload once when a newer version of the app has been published (browsers keep old copies).
  async function checkForUpdate() {
    try {
      const mine = (document.querySelector('script[src*="app.js"]') || {}).src || '';
      const cur = (mine.match(/v=([\w-]+)/) || [])[1];
      const html = await fetch('index.html?check=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
      const live = (html.match(/app\.js\?v=([\w-]+)/) || [])[1];
      if (cur && live && cur !== live && sessionStorage.getItem('solar-reloaded') !== live) {
        sessionStorage.setItem('solar-reloaded', live);
        location.reload();
      }
    } catch (e) { /* offline: keep the current copy */ }
  }
  checkForUpdate();
  setInterval(checkForUpdate, 30 * 60 * 1000);

  boot();
})();
