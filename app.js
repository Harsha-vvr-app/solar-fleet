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
  const routes = { overview, tickets, ticket, bills, grid, sites: sitesPage, systems, planned, settings, users, bulk };
  function route() {
    const [name, arg] = (location.hash.slice(1) || 'overview').split('/');
    const fn = routes[name] || overview;
    document.querySelectorAll('.side a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === (name === 'ticket' ? 'tickets' : name)));
    if (name !== 'sites') window.scrollTo(0, 0);
    document.querySelectorAll('.side a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
    main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    Promise.resolve(fn(arg)).catch((e) => { main.replaceChildren(h('p', { class: 'error' }, 'This page could not load: ' + (e.message || e))); });
    main.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => state.me && route());

  /* ---------- overview ---------- */
  async function overview() {
    const [status, gen, open, notLive, waitingBills, cov] = await Promise.all([
      q(sb.from('solar_system_status').select('*').eq('tracking', 'Live').neq('type', 'Grid meter').order('sort')),
      q(sb.from('solar_generation').select('date, system_id, kwh, note').gte('date', addDays(today(), -15)).order('date')),
      q(sb.from('solar_tickets').select('*').neq('status', 'Closed')),
      q(sb.from('solar_systems').select('id, tracking, type').not('tracking', 'in', '("Live","Retired")')),
      q(sb.from('solar_eb_bills').select('*').eq('status', 'Submitted').order('uploaded_at')),
      Promise.all([q(sb.from('solar_systems').select('tracking, type')), q(sb.from('solar_eb_connections').select('tracking')), q(sb.from('solar_sites').select('id')),
        q(sb.from('solar_eb_connections').select('site_id'))]),
    ]);
    const withExp = status.filter((s) => s.expected_kwh != null);
    const ids = withExp.map((s) => s.id);
    const dates = [...new Set(gen.map((g) => g.date))].sort().reverse();
    const day = dates.find((d) => ids.every((id) => gen.some((g) => g.date === d && g.system_id === id))) || dates[0];
    const expected = d3.sum(withExp, (s) => +s.expected_kwh);
    const actual = d3.sum(gen.filter((g) => g.date === day && ids.includes(g.system_id)), (g) => +g.kwh || 0);
    const pct = expected ? Math.round((actual / expected) * 100) : null;
    const overdue = open.filter((t) => t.due && t.due < today() && t.type !== 'Setup').length;
    const faults = open.filter((t) => t.type !== 'Setup' && t.type !== 'Task').length;
    const tasks = open.filter((t) => t.type === 'Task').sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));

    const fig = (v, l, cls) => h('div', { class: 'fig' + (cls ? ' ' + cls : '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const head = pageHead('Overview', `${status.length} live systems. Expected figures are each system's average over its last 14 good days.`);
    const fleet = h('section', { class: 'panel fleet' },
      h('div', { class: 'fleet-figs' },
        fig(n0(expected), 'units expected per day'),
        fig(n0(actual), 'units made on ' + fmtDay(day)),
        fig(pct == null ? '—' : pct + '%', 'of expected', pct != null && pct < 75 ? 'low' : pct != null && pct < 90 ? 'mid' : null)),
      h('div', { class: 'fleet-figs' },
        fig(String(faults), 'open tickets'),
        fig(String(tasks.length), 'open tasks'),
        fig(String(overdue), 'overdue', overdue ? 'low' : null)));

    const rows = h('div', { class: 'sys-rows' }, status.map((s) => {
      const mine = gen.filter((g) => g.system_id === s.id);
      const y = mine.find((g) => g.date === day);
      const exp = +s.expected_kwh || 0;
      const scale = Math.max(exp * 1.4, y ? +y.kwh : 0, 1);
      const share = y && exp ? (+y.kwh / exp) : null;
      const bar = h('div', { class: 'sunbar', role: 'img', 'aria-label': `${s.site}: ${y ? n1(y.kwh) : 'no'} units against ${n1(exp)} expected` },
        h('div', { class: 'fill' + (share != null && share < 0.6 ? ' low' : ''), style: `width:${y ? Math.min(100, (+y.kwh / scale) * 100) : 0}%` }),
        exp ? h('div', { class: 'mark', style: `left:${(exp / scale) * 100}%` }) : null);
      const att = s.attention;
      const chipCls = !att || att === 'OK' || att === 'Open item' ? 'ok' : 'bad';
      return h('div', { class: 'sys-row' },
        h('div', { class: 'sys-name' }, h('strong', null, s.site), h('span', null, `${s.system || ''} · ${s.type || ''}`)),
        h('div', null, bar, h('div', { class: 'sunbar-caption' }, (y ? `${n1(y.kwh)} units on ${fmtDay(day)}` : `No figure for ${fmtDay(day)}`) + (s.expected_kwh != null ? ` · expected ${n1(s.expected_kwh)}` : ''))),
        h('div', { class: 'spark' }, spark(mine, day)),
        h('span', { class: 'chip ' + (chipCls || '') }, att === 'Open item' ? 'OK' : att || 'OK'));
    }));
    const pendingSys = notLive.filter((x) => x.tracking !== 'Not installed').length;
    const plannedSys = notLive.length - pendingSys;
    const leftOff = notLive.length ? h('p', { class: 'muted' }, h('a', { href: '#systems' },
      [pendingSys && `${pendingSys} system${pendingSys > 1 ? 's' : ''} not tracked yet`, plannedSys && `${plannedSys} planned install${plannedSys > 1 ? 's' : ''}`].filter(Boolean).join(' and ')),
      ' are left off this list.') : null;
    const queue = waitingBills.length ? h('section', null, h('h2', null, isOwner() ? 'Bills waiting for your approval' : 'Bills waiting for approval'),
      h('div', { class: 'panel' }, h('ul', { class: 'plain queue' }, waitingBills.map((b) => h('li', null,
        h('button', { class: 'link', onclick: () => billDetail(b) }, b.site),
        h('span', { class: 'muted' }, ` · ${b.period_to ? 'period to ' + fmtDate(b.period_to) : fmtDate(b.bill_date)} · ${n0(b.billed_kwh ?? b.import_kwh)} units${b.amount != null ? ' · ₹' + d3.format(',.0f')(b.amount) : ''} · from ${b.uploaded_by_name || 'admin'}`)))))) : null;
    const [cSys, cEb, cSites, cConnSites] = cov;
    const sysAll = cSys.filter((x) => x.type !== 'Grid meter' && x.tracking !== 'Retired');
    const ebAll = cEb.filter((x) => x.tracking !== 'Retired');
    const noConn = cSites.filter((x) => !cConnSites.some((c) => c.site_id === x.id)).length;
    const meter = (label, n, of, href) => h('a', { class: 'cov', href },
      h('div', { class: 'cov-top' }, h('strong', null, `${n} of ${of}`), h('span', { class: 'muted' }, label)),
      h('div', { class: 'cov-bar' }, h('div', { style: `width:${of ? (n / of) * 100 : 0}%` })));
    const coverage = h('section', { class: 'panel coverage' },
      h('h3', null, 'Tracking coverage'),
      h('div', { class: 'cov-grid' },
        meter('EB lines tracked', ebAll.filter((x) => x.tracking === 'Live').length, ebAll.length, '#grid'),
        meter('solar systems tracked', sysAll.filter((x) => x.tracking === 'Live').length, sysAll.length, '#systems')),
      noConn ? h('p', { class: 'muted' }, h('a', { href: '#sites' }, `${noConn} site${noConn > 1 ? 's have' : ' has'} no EB connection entered`), ', so coverage there is unknown.') : null);
    const t0 = today();
    const taskSec = h('section', null, h('div', { class: 'sec-head' }, h('h2', null, 'Open tasks'),
        canWrite() ? h('button', { class: 'btn', onclick: async () => newTask((await loadSites()).sites) }, 'New task') : null),
      h('div', { class: 'panel' }, tasks.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Due', 'Site', 'Task', 'Assigned to', ''].map((c) => h('th', null, c)))),
        h('tbody', null, tasks.map((t) => h('tr', { class: 'click' + (t.due < t0 ? ' overdue' : ''), onclick: (e) => { if (!e.target.closest('button')) location.hash = 'ticket/' + t.id; } },
          h('td', { class: 'nw' + (t.due < t0 ? ' due-bad' : '') }, t.due ? fmtDay(t.due) + (t.due < t0 ? ' · overdue' : t.due === t0 ? ' · today' : '') : '—'),
          h('td', null, t.site || '—'), h('td', null, t.reason), h('td', null, t.assigned_to || '—'),
          h('td', { class: 'row-actions' }, canWrite() ? h('button', { class: 'btn small', onclick: () => closeTicketDialog(t, () => { route(); refreshCounts(); }) }, 'Done') : null))))))
        : h('p', { class: 'empty' }, 'No open tasks. Add one from here or from a site card.')));
    main.replaceChildren(...[head, queue, fleet, coverage, taskSec].filter(Boolean),
      h('section', null, h('div', { class: 'sec-head' }, h('h2', null, 'Each system against its expected day'),
        h('p', { class: 'muted' }, 'The line marks the expected day. Red when a system made under 60% of it.')),
        h('div', { class: 'panel' }, rows), leftOff));
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
    const t0 = today();
    const isOver = (t) => t.due && t.due < t0 && t.status !== 'Closed';
    const myName = (state.me.name || '').trim().toLowerCase();
    const passes = (t) => (!ticketFilter.site || (t.site_id || siteOf[t.system_id]) === ticketFilter.site)
      && (!ticketFilter.mine || (t.assigned_to || '').trim().toLowerCase() === myName);
    const tabs = [
      ['open', 'Open faults and issues', (t) => t.status !== 'Closed' && t.type !== 'Setup' && t.type !== 'Task'],
      ['tasks', 'Tasks', (t) => t.status !== 'Closed' && t.type === 'Task'],
      ['setup', 'Setup questions', (t) => t.status !== 'Closed' && t.type === 'Setup'],
      ['closed', 'Closed', (t) => t.status === 'Closed'],
    ];
    const body = h('div');
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });

    async function setStatus(t, status, extra = {}) {
      await q(sb.from('solar_tickets').update({ status, ...extra }).eq('id', t.id));
      Object.assign(t, { status, ...extra });
      toast(status === 'Closed' ? tno(t.id) + ' closed' : tno(t.id) + ' started');
      refreshCounts(); drawTabs(); draw();
    }
    const closeTicket = (t) => closeTicketDialog(t, () => { Object.assign(t, { status: 'Closed' }); refreshCounts(); drawTabs(); draw(); });
    function draw() {
      const [, , f] = tabs.find((x) => x[0] === ticketTab);
      let list = all.filter((t) => f(t) && passes(t));
      if (ticketTab !== 'closed') list.sort((a, b) => (isOver(b) - isOver(a)) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.id - b.id);
      const open = (t) => { location.hash = 'ticket/' + t.id; };
      body.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Ticket', 'Raised', ticketTab === 'closed' ? 'Closed' : 'Due', 'System', 'Reason', 'Status', 'Assigned to', ''].map((c) => h('th', null, c)))),
        h('tbody', null, list.map((t) => h('tr', { class: 'click' + (isOver(t) ? ' overdue' : ''), tabindex: 0,
          onclick: (e) => { if (!e.target.closest('button')) open(t); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target.tagName === 'TR') open(t); } },
          h('td', { class: 'nw' }, tno(t.id)), h('td', { class: 'nw' }, fmtDay(t.raised)),
          h('td', { class: 'nw' + (isOver(t) ? ' due-bad' : '') }, ticketTab === 'closed' ? fmtDay(t.closed_on) : (t.due ? fmtDay(t.due) + (isOver(t) ? ' · overdue' : '') : 'No deadline')),
          h('td', null, t.site || t.system_id || '—'), h('td', null, t.reason),
          h('td', null, h('span', { class: 'chip ' + (t.status === 'Open' ? 'bad' : t.status === 'Closed' ? 'ok' : 'amber') }, t.status)),
          h('td', null, t.assigned_to || '—'),
          h('td', { class: 'row-actions' }, canWrite() && t.status !== 'Closed' ? [
            t.status === 'Open' ? h('button', { class: 'btn small', onclick: () => setStatus(t, 'In progress', t.assigned_to ? {} : { assigned_to: state.me.name }) }, 'Start') : null,
            h('button', { class: 'btn small', onclick: () => closeTicket(t) }, t.type === 'Task' ? 'Done' : 'Close')] : null))))))
        : h('p', { class: 'empty' }, ticketTab === 'closed' ? 'No closed tickets match.' : 'Nothing open here.'));
    }
    function drawTabs() {
      tabBar.replaceChildren(...tabs.map(([k, l, f]) => h('button', {
        role: 'tab', 'aria-selected': String(ticketTab === k),
        onclick: () => { ticketTab = k; drawTabs(); draw(); },
      }, `${l} (${all.filter((t) => f(t) && passes(t)).length})`)));
    }
    const siteSel = select('tk-site', ticketFilter.site, [['', 'All sites'], ...sites.map((x) => [x.id, x.name])]);
    siteSel.addEventListener('change', () => { ticketFilter.site = siteSel.value; drawTabs(); draw(); });
    const mine = h('input', { type: 'checkbox', id: 'tk-mine' }); mine.checked = ticketFilter.mine;
    mine.addEventListener('change', () => { ticketFilter.mine = mine.checked; drawTabs(); draw(); });
    const filters = h('div', { class: 'filters' }, field('Site', siteSel), h('label', { class: 'check', for: 'tk-mine' }, mine, ' Assigned to me'));
    drawTabs(); draw();
    main.replaceChildren(
      pageHead('Tickets', 'Faults are raised every night from the meter data and are due within a week. Start a ticket when work begins; close it by writing what was done.',
        canWrite() ? h('button', { class: 'btn', onclick: async () => { await q(sb.rpc('solar_run_checks_now')); toast('Checks run'); route(); refreshCounts(); } }, 'Run checks now') : null,
        canWrite() ? h('button', { class: 'btn', onclick: () => newTask(sites, ticketFilter.site, () => { ticketTab = 'tasks'; route(); }) }, 'New task') : null,
        canWrite() ? h('button', { class: 'btn primary', onclick: () => newTicket(systemsList) }, 'New ticket') : null),
      h('section', { class: 'panel' }, filters, tabBar, body));
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

  function newTask(sites, presetSite, onDone) {
    const site = select('ta-site', presetSite || '', [['', 'Choose a site'], ...sites.map((x) => [x.id, x.name])]);
    site.required = true;
    const reason = input('ta-reason', '', { required: true, placeholder: 'For example: clean panels, fix earthing, replace battery cables' });
    const details = h('textarea', { id: 'ta-details' });
    const due = input('ta-due', addDays(today(), 7), { type: 'date', required: true });
    const assigned = input('ta-assigned', '');
    openDialog(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const st = sites.find((x) => x.id === site.value);
      await q(sb.from('solar_tickets').insert({ type: 'Task', site_id: site.value, site: st ? st.name : null, reason: reason.value.trim(),
        details: details.value.trim() || null, due: due.value, assigned_to: assigned.value.trim() || null }));
      closeDialog(); toast('Task added'); refreshCounts(); onDone ? onDone() : route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'New task'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
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
      closeDialog(); toast('Ticket ' + tno(row.id) + ' raised'); location.hash = 'ticket/' + row.id; refreshCounts();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, 'New ticket'), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
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
    const status = select('tk-status', t.status, ['Open', 'In progress', 'Closed']);
    const assigned = input('tk-assigned', t.assigned_to);
    const due = input('tk-due', t.due, { type: 'date' });
    const resolution = h('textarea', { id: 'tk-resolution', placeholder: 'What was found and what was done. Needed before closing.' }, t.resolution || '');
    [status, assigned, due, resolution].forEach((el) => { el.disabled = ro; });
    const save = h('button', { class: 'btn primary', type: 'submit', disabled: ro }, 'Save');
    const form = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      if (status.value === 'Closed' && !resolution.value.trim()) { toast('Write what was done in Resolution before closing.', true); resolution.focus(); return; }
      await q(sb.from('solar_tickets').update({ status: status.value, assigned_to: assigned.value.trim() || null, due: due.value || null, resolution: resolution.value.trim() || null }).eq('id', id));
      toast(status.value === 'Closed' && t.status !== 'Closed' ? 'Ticket closed' : 'Saved'); refreshCounts(); route();
    } },
      h('div', { class: 'form-grid' }, field('Status', status), field('Assigned to', assigned), field('Due', due), field('Resolution', resolution, 'wide')),
      h('div', { class: 'actions' }, save));

    const photos = await photoPanel(t, ro);
    const noteBox = h('textarea', { id: 'tk-note', placeholder: 'Add an update: a site visit, a call, a part ordered' });
    const noteList = h('div', { class: 'notes' }, notes.length ? notes.map((n) => h('div', { class: 'note' + (n.author ? '' : ' system') },
      h('div', { class: 'meta' }, `${n.author_name || 'System'} · ${d3.timeFormat('%-d %b, %H:%M')(new Date(n.created_at))}`), h('p', null, n.body)))
      : h('p', { class: 'muted' }, 'No notes yet.'));
    const noteForm = h('form', { class: 'notes', onsubmit: async (e) => {
      e.preventDefault();
      if (!noteBox.value.trim()) return;
      await q(sb.from('solar_ticket_notes').insert({ ticket_id: +id, author: state.user.id, author_name: state.me.name, body: noteBox.value.trim() }));
      toast('Note added'); route();
    } }, field('New note', noteBox), h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit', disabled: ro }, 'Add note')));

    main.replaceChildren(
      h('p', null, h('a', { href: '#tickets' }, 'All tickets')),
      pageHead(`${tno(t.id)} · ${t.reason}`, `${t.type} · ${t.site || t.system_id || 'No system'} · raised ${fmtDate(t.raised)}${t.closed_on ? ' · closed ' + fmtDate(t.closed_on) : ''}`),
      t.details ? h('section', { class: 'panel' }, h('h3', null, t.auto ? 'What the check saw' : 'Details'), h('p', null, t.details)) : null,
      form, photos,
      h('section', { class: 'panel' }, h('h3', null, 'Notes'), noteList, ro ? null : noteForm));
  }

  /* ---------- EB bills ---------- */
  // A bill belongs to the month its period ends in (or its bill date when there is no period).
  const billMonth = (b) => (b.period_to || b.bill_date || b.uploaded_at || '').slice(0, 7);
  async function bills() {
    const [list, sitesData] = await Promise.all([
      q(sb.from('solar_eb_bills').select('*').order('uploaded_at', { ascending: false })),
      loadSites(),
    ]);
    const { sites, conns } = sitesData;
    const now = today().slice(0, 7);
    const months = d3.range(11, -1, -1).map((k) => { const d = new Date(Date.parse(now + '-01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
    const mLabel = (m) => d3.utcFormat('%b %y')(new Date(m + '-01T00:00:00Z'));
    const waiting = list.filter((b) => b.status === 'Submitted');
    const unassigned = list.filter((b) => !b.eb_connection_id);

    const cell = (c, m) => {
      const here = list.filter((b) => b.eb_connection_id === c.id && billMonth(b) === m);
      if (!here.length) {
        return h('td', { class: 'bill-cell empty-cell' }, canWrite()
          ? h('button', { class: 'cell-add', 'aria-label': `Upload the ${mLabel(m)} bill for ${c.label}`, onclick: () => uploadBill(sitesData, c.site_id, c.id, m) }, '+') : '');
      }
      return h('td', { class: 'bill-cell' }, here.map((b) => h('button', {
        class: 'bill-chip ' + (b.status === 'Approved' ? 'ok' : b.status === 'Rejected' ? 'bad' : 'wait'), onclick: () => billDetail(b),
        title: `${b.site} · ${b.status === 'Submitted' ? 'awaiting approval' : b.status.toLowerCase()}` },
        h('span', { class: 'u' }, n0(b.billed_kwh ?? b.import_kwh)), h('span', { class: 'a' }, b.amount == null ? '' : '₹' + d3.format('.3~s')(b.amount)))));
    };
    const grid = h('div', { class: 'table-wrap' }, h('table', { class: 'bill-grid' },
      h('thead', null, h('tr', null, h('th', null, 'EB connection'), months.map((m) => h('th', { class: 'n' }, mLabel(m))))),
      sites.filter((site) => conns.some((c) => c.site_id === site.id)).map((site) => h('tbody', null,
        h('tr', { class: 'group' }, h('th', { colspan: months.length + 1 }, h('a', { href: '#sites/' + site.id }, site.name))),
        conns.filter((c) => c.site_id === site.id).map((c) => h('tr', null,
          h('th', { class: 'conn' }, c.label, c.service_no ? h('span', { class: 'muted' }, ' · ' + c.service_no) : null),
          months.map((m) => cell(c, m))))))));

    const plainTable = (rows) => h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Site', 'Period', 'Billed kWh', 'Amount ₹', 'Status', ''].map((c, i) => h('th', { class: i === 2 || i === 3 ? 'n' : null }, c)))),
      h('tbody', null, rows.map((b) => h('tr', null,
        h('td', null, b.site), h('td', null, b.period_from ? `${fmtDay(b.period_from)} to ${fmtDate(b.period_to)}` : fmtDate(b.bill_date)),
        h('td', { class: 'n' }, n0(b.billed_kwh ?? b.import_kwh)), h('td', { class: 'n' }, b.amount == null ? '—' : d3.format(',.0f')(b.amount)),
        h('td', null, h('span', { class: 'chip ' + (b.status === 'Approved' ? 'ok' : b.status === 'Rejected' ? 'bad' : 'amber') }, b.status === 'Submitted' ? 'Awaiting approval' : b.status)),
        h('td', null, h('button', { class: 'link', onclick: () => billDetail(b) }, 'Open')))))));

    main.replaceChildren(...[
      pageHead('EB bills', 'One row per EB connection, one column per month. Click a blank cell to upload that month\'s bill; click a bill to open or approve it.',
        canWrite() ? h('button', { class: 'btn primary', onclick: () => uploadBill(sitesData) }, 'Upload a bill') : null),
      waiting.length ? h('section', null, h('h2', null, isOwner() ? 'Waiting for your approval' : 'Waiting for approval'), h('div', { class: 'panel' }, plainTable(waiting))) : null,
      h('section', null, h('div', { class: 'sec-head' }, h('h2', null, 'Last 12 months'),
        h('p', { class: 'legend' }, h('span', { class: 'bill-chip ok' }, 'Approved'), h('span', { class: 'bill-chip wait' }, 'Awaiting approval'), h('span', { class: 'bill-chip bad' }, 'Rejected'))),
        h('p', { class: 'muted' }, 'Bills are filed under the month their period ends. TNEB bills most connections every two months, so a blank month between two bills is normal.'),
        h('div', { class: 'panel' }, grid)),
      unassigned.length ? h('section', null, h('h2', null, 'Bills not linked to an EB connection'), h('div', { class: 'panel' }, plainTable(unassigned))) : null].filter(Boolean));
    grid.scrollLeft = grid.scrollWidth; // newest months first in view
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
      file: input('bl-file', '', { type: 'file', accept: 'application/pdf,image/*', required: true }),
      notes: h('textarea', { id: 'bl-notes' }),
    };
    conn.addEventListener('change', () => { const c = conns.find((x) => String(x.id) === conn.value); if (c && c.service_no && !f.service.value) f.service.value = c.service_no; });
    if (presetSite) setTimeout(fillConns);
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
          import_kwh: num(f.imp), export_kwh: num(f.exp), billed_kwh: num(f.billed), amount: num(f.amount),
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
        field('Site', sys), field('EB connection', conn), field('Service number', f.service), field('Bill date', f.billDate),
        field('Period from', f.from), field('Period to', f.to),
        field('Units imported (kWh)', f.imp), field('Units exported (kWh)', f.exp),
        field('Units billed (kWh)', f.billed), field('Amount (₹)', f.amount),
        field('Bill file (PDF or photo)', f.file, 'wide'), field('Notes', f.notes, 'wide')),
      h('div', { class: 'actions' }, btn));
    openDialog(form);
  }

  async function billDetail(b) {
    let link = null;
    if (b.file_path) {
      const s = await sb.storage.from('solar-bills').createSignedUrl(b.file_path, 600);
      link = s.data && s.data.signedUrl;
    }
    const note = h('textarea', { id: 'bd-note', placeholder: 'Needed when rejecting' }, b.review_note || '');
    const review = async (status) => {
      if (status === 'Rejected' && !note.value.trim()) { toast('Add a note saying why the bill is rejected.', true); note.focus(); return; }
      await q(sb.from('solar_eb_bills').update({ status, review_note: note.value.trim() || null }).eq('id', b.id));
      closeDialog(); toast(status === 'Approved' ? 'Bill approved' : 'Bill rejected'); refreshCounts(); route();
    };
    const kv = (k, v) => h('div', { class: 'field' }, h('label', null, k), h('div', { class: 'num' }, v));
    openDialog(h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' }, h('h2', null, b.site), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Close')),
      h('div', { class: 'form-grid' },
        kv('Service number', b.service_no || '—'), kv('Bill date', fmtDate(b.bill_date)),
        kv('Period', b.period_from ? `${fmtDate(b.period_from)} to ${fmtDate(b.period_to)}` : '—'),
        kv('Units imported', n0(b.import_kwh)), kv('Units exported', n0(b.export_kwh)), kv('Units billed', n0(b.billed_kwh)),
        kv('Amount', b.amount == null ? '—' : '₹' + d3.format(',.0f')(b.amount)),
        kv('Uploaded', `${b.uploaded_by_name || ''} · ${d3.timeFormat('%-d %b %Y')(new Date(b.uploaded_at))}`),
        kv('Status', b.status === 'Submitted' ? 'Awaiting approval' : b.status)),
      b.notes ? h('p', null, b.notes) : null,
      link ? h('p', null, h('a', { href: link, target: '_blank', rel: 'noopener' }, 'Open the bill file')) : h('p', { class: 'muted' }, 'No file attached.'),
      isOwner() && b.status === 'Submitted' ? h('div', { class: 'form-grid' }, field('Review note', note, 'wide')) : (b.review_note ? h('p', null, 'Review note: ' + b.review_note) : null),
      isOwner() && b.status === 'Submitted' ? h('div', { class: 'actions' },
        h('button', { class: 'btn reject', onclick: () => review('Rejected') }, 'Reject'),
        h('button', { class: 'btn approve', onclick: () => review('Approved') }, 'Approve')) : null));
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
          h('a', { href: '#sites/' + c.site_id }, `${siteName[c.site_id] || c.site_id} · ${c.label}`), h('span', { class: 'muted' }, ` · ${c.code} · ${c.tracked_via}`)))))) : null].filter(Boolean));
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
          h('h3', null, site.name),
          w ? h('button', { class: 'link small', onclick: () => editSite(site, sites) }, 'Edit') : null),
        site.address ? h('p', { class: 'muted sc-addr' }, site.address) : null,
        cap ? h('p', { class: 'site-cap' }, cap) : null,
        line('EB', ebs.length ? h('span', null, ebs.flatMap((c, i) => [i ? h('br') : '', h('span', { class: 'dot ' + (c.tracking === 'Live' ? 'on' : c.tracking === 'Retired' ? 'off' : 'wait'), title: c.tracking === 'Live' ? 'Tracked' : c.tracking }),
          w ? h('button', { class: 'link', onclick: () => editConn(c, site) }, c.label) : c.label,
          h('span', { class: 'muted' }, ` ${c.code}${c.tracking === 'Live' ? '' : ' · not tracked'}`)])) : h('span', { class: 'due-bad' }, 'none entered')),
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
    const device = input('eb-device', c && c.source_id, { placeholder: 'Meter or device ID' });
    const target = input('eb-target', c && c.daylight_target_kwh, { type: 'number', step: 'any', min: 0 });
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
        tracking: tracking.value, tracked_via: via.value, source_id: device.value.trim() || null, daylight_target_kwh: num(target) };
      if (isNew) await q(sb.from('solar_eb_connections').insert({ site_id: site.id, ...row }));
      else await q(sb.from('solar_eb_connections').update(row).eq('id', c.id));
      closeDialog(); toast('EB connection saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, (isNew ? 'Add an EB connection · ' : `${c.code} · `) + site.name), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' }, field('Name', label), field('Service number', service), field('Tariff', tariff), field('Phase', phase),
        field('Sanctioned load (kW)', kw), field('Meter CT multiplier', ct)),
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
        onclick: () => editSystem(s), onkeydown: (e) => { if (e.key === 'Enter') editSystem(s); } },
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
      const shown = list.filter(matches);
      const groups = sites.map((site) => ({ site, rows: shown.filter((x) => x.site_id === site.id) })).filter((g) => g.rows.length);
      body.replaceChildren(...(groups.length ? groups.map((g) => h('section', { class: 'sysx-group' },
        h('div', { class: 'sysx-head' },
          h('h3', null, h('a', { href: '#sites/' + g.site.id }, g.site.name)),
          g.site.site_type ? h('span', { class: 'chip' }, g.site.site_type) : null,
          h('span', { class: 'muted' }, capText(capSum(g.rows.filter((x) => x.tracking !== 'Retired'))))),
        h('div', { class: 'panel sysx-list' }, g.rows.map(row)))) : [h('p', { class: 'empty' }, 'No systems match.')]));
    }
    const search = input('sx-q', sysFilter.q, { type: 'search', placeholder: 'Search by ID, name or site' });
    search.addEventListener('input', () => { sysFilter.q = search.value; draw(); });
    const type = select('sx-type', sysFilter.type, [['', 'All types'], ...[...new Set(list.map((x) => x.type).filter(Boolean))].map((t) => [t, t])]);
    type.addEventListener('change', () => { sysFilter.type = type.value; draw(); });
    const status = select('sx-status', sysFilter.status, [['', 'Any status'], ['attention', 'Needs attention'], ['live', 'Tracked live'], ['notlive', 'Not tracked yet']]);
    status.addEventListener('change', () => { sysFilter.status = status.value; draw(); });
    draw();
    main.replaceChildren(
      pageHead('Systems', `Grouped by site. Click a system to edit it. Panel ÷ inverter above ${RATIO_HIGH}× is marked amber.`,
        canWrite() ? h('button', { class: 'btn primary', onclick: () => editSystem(null) }, 'Add a system') : null),
      h('div', { class: 'filters sx-filters' }, field('Search', search), field('Type', type), field('Status', status)),
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
    const nextId = () => { let k = 1; while (all.some((x) => x.id === 'S' + String(k).padStart(2, '0'))) k++; return 'S' + String(k).padStart(2, '0'); };
    const id = input('sy-id', s ? s.id : nextId(), { required: true });
    if (!isNew) id.disabled = true;
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
    const source = input('sy-source', s && s.source_id, { placeholder: 'Device ID or station ID' });
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
      if (isNew) await q(sb.from('solar_systems').insert({ id: id.value.trim().toUpperCase(), sort: all.length + 1, ...row }));
      else await q(sb.from('solar_systems').update(row).eq('id', s.id));
      closeDialog(); toast(isNew ? 'System added' : 'Saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, isNew ? 'Add a system' : `${s.id} · ${s.site}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      h('div', { class: 'form-grid' },
        field('Site', site), field('ID', id), field('System name', system), field('Type', type),
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
    ['Systems', 'Leave System ID blank for a new system (an ID like S22 is given). Type: ' + SYS_TYPES.join(', ') + '. Tracking: ' + TRACKING.join(', ') + '.'],
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
    const nextSys = () => { let k = 1; while (usedIds.has('S' + String(k).padStart(2, '0'))) k++; const id = 'S' + String(k).padStart(2, '0'); usedIds.add(id); return id; };
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
        if (g.id && !/^[A-Z0-9-]{1,12}$/.test(g.id)) { errors.push(`${where}: System ID "${g.id}" should be short, like S22.`); return; }
        const id = g.id || nextSys(); usedIds.add(id);
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

  boot();
})();
