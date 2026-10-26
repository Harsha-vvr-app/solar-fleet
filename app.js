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
  const routes = { overview, tickets, ticket, bills, grid, systems, planned, settings, users };
  function route() {
    const [name, arg] = (location.hash.slice(1) || 'overview').split('/');
    const fn = routes[name] || overview;
    document.querySelectorAll('.side a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === (name === 'ticket' ? 'tickets' : name)));
    document.querySelectorAll('.side a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
    main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    Promise.resolve(fn(arg)).catch((e) => { main.replaceChildren(h('p', { class: 'error' }, 'This page could not load: ' + (e.message || e))); });
    main.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => state.me && route());

  /* ---------- overview ---------- */
  async function overview() {
    const [status, gen, open] = await Promise.all([
      q(sb.from('solar_system_status').select('*').eq('tracking', 'Live').neq('type', 'Grid meter').order('sort')),
      q(sb.from('solar_generation').select('date, system_id, kwh, note').gte('date', addDays(today(), -15)).order('date')),
      q(sb.from('solar_tickets').select('id, due, status, type').neq('status', 'Closed')),
    ]);
    const withExp = status.filter((s) => s.expected_kwh != null);
    const ids = withExp.map((s) => s.id);
    const dates = [...new Set(gen.map((g) => g.date))].sort().reverse();
    const day = dates.find((d) => ids.every((id) => gen.some((g) => g.date === d && g.system_id === id))) || dates[0];
    const expected = d3.sum(withExp, (s) => +s.expected_kwh);
    const actual = d3.sum(gen.filter((g) => g.date === day && ids.includes(g.system_id)), (g) => +g.kwh || 0);
    const pct = expected ? Math.round((actual / expected) * 100) : null;
    const overdue = open.filter((t) => t.due && t.due < today() && t.type !== 'Setup').length;
    const faults = open.filter((t) => t.type !== 'Setup').length;

    const fig = (v, l, cls) => h('div', { class: 'fig' + (cls ? ' ' + cls : '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const head = pageHead('Overview', `${status.length} live systems. Expected figures are each system's average over its last 14 good days.`);
    const fleet = h('section', { class: 'panel fleet' },
      h('div', { class: 'fleet-figs' },
        fig(n0(expected), 'units expected per day'),
        fig(n0(actual), 'units made on ' + fmtDay(day)),
        fig(pct == null ? '—' : pct + '%', 'of expected', pct != null && pct < 75 ? 'low' : pct != null && pct < 90 ? 'mid' : null)),
      h('div', { class: 'fleet-figs' },
        fig(String(faults), 'open tickets', faults ? null : null),
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
    main.replaceChildren(head, fleet,
      h('section', null, h('div', { class: 'sec-head' }, h('h2', null, 'Each system against its expected day'),
        h('p', { class: 'muted' }, 'The line marks the expected day. Red when a system made under 60% of it.')),
        h('div', { class: 'panel' }, rows)));
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
  async function tickets() {
    const [all, systemsList] = await Promise.all([
      q(sb.from('solar_tickets').select('*').order('id', { ascending: false })),
      q(sb.from('solar_systems').select('id, site, system').order('sort')),
    ]);
    const t0 = today();
    const isOver = (t) => t.due && t.due < t0 && t.status !== 'Closed';
    const tabs = [
      ['open', 'Open faults and issues', (t) => t.status !== 'Closed' && t.type !== 'Setup'],
      ['setup', 'Setup questions', (t) => t.status !== 'Closed' && t.type === 'Setup'],
      ['closed', 'Closed', (t) => t.status === 'Closed'],
    ];
    const body = h('div');
    function draw() {
      const [, , f] = tabs.find((x) => x[0] === ticketTab);
      let list = all.filter(f);
      if (ticketTab !== 'closed') list.sort((a, b) => (isOver(b) - isOver(a)) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.id - b.id);
      body.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Ticket', 'Raised', ticketTab === 'closed' ? 'Closed' : 'Due', 'System', 'Reason', 'Status', 'Assigned to'].map((c) => h('th', null, c)))),
        h('tbody', null, list.map((t) => h('tr', { class: 'click' + (isOver(t) ? ' overdue' : ''), tabindex: 0,
          onclick: () => { location.hash = 'ticket/' + t.id; },
          onkeydown: (e) => { if (e.key === 'Enter') location.hash = 'ticket/' + t.id; } },
          h('td', null, tno(t.id)), h('td', null, fmtDay(t.raised)),
          h('td', { class: isOver(t) ? 'due-bad' : null }, ticketTab === 'closed' ? fmtDay(t.closed_on) : (t.due ? fmtDay(t.due) + (isOver(t) ? ' · overdue' : '') : 'No deadline')),
          h('td', null, t.site || t.system_id || '—'), h('td', null, t.reason),
          h('td', null, h('span', { class: 'chip ' + (t.status === 'Open' ? 'bad' : t.status === 'Closed' ? 'ok' : 'amber') }, t.status)),
          h('td', null, t.assigned_to || '—'))))))
        : h('p', { class: 'empty' }, ticketTab === 'closed' ? 'No closed tickets yet.' : 'Nothing open here.'));
    }
    const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l, f]) => h('button', {
      role: 'tab', 'aria-selected': String(ticketTab === k),
      onclick: (e) => { ticketTab = k; tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget))); draw(); },
    }, `${l} (${all.filter(f).length})`)));
    draw();
    main.replaceChildren(
      pageHead('Tickets', 'Faults are raised every night from the meter data and are due within a week. Close a ticket by writing what was done.',
        canWrite() ? h('button', { class: 'btn', onclick: async () => { await q(sb.rpc('solar_run_checks_now')); toast('Checks run'); route(); refreshCounts(); } }, 'Run checks now') : null,
        canWrite() ? h('button', { class: 'btn primary', onclick: () => newTicket(systemsList) }, 'New ticket') : null),
      h('section', { class: 'panel' }, tabBar, body));
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
      t.details ? h('section', { class: 'panel' }, h('h3', null, 'What the check saw'), h('p', null, t.details)) : null,
      form,
      h('section', { class: 'panel' }, h('h3', null, 'Notes'), noteList, ro ? null : noteForm));
  }

  /* ---------- EB bills ---------- */
  async function bills() {
    const [list, systemsList] = await Promise.all([
      q(sb.from('solar_eb_bills').select('*').order('uploaded_at', { ascending: false })),
      q(sb.from('solar_systems').select('id, site, system').order('sort')),
    ]);
    const waiting = list.filter((b) => b.status === 'Submitted');
    const table = (rows) => rows.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Site', 'Service no.', 'Period', 'Imported kWh', 'Exported kWh', 'Billed kWh', 'Amount ₹', 'Status', ''].map((c, i) => h('th', { class: i >= 3 && i <= 6 ? 'n' : null }, c)))),
      h('tbody', null, rows.map((b) => h('tr', null,
        h('td', null, b.site), h('td', null, b.service_no || '—'),
        h('td', null, b.period_from ? `${fmtDay(b.period_from)} to ${fmtDate(b.period_to)}` : fmtDate(b.bill_date)),
        h('td', { class: 'n' }, n0(b.import_kwh)), h('td', { class: 'n' }, n0(b.export_kwh)), h('td', { class: 'n' }, n0(b.billed_kwh)),
        h('td', { class: 'n' }, b.amount == null ? '—' : d3.format(',.0f')(b.amount)),
        h('td', null, h('span', { class: 'chip ' + (b.status === 'Approved' ? 'ok' : b.status === 'Rejected' ? 'bad' : 'amber') }, b.status === 'Submitted' ? 'Awaiting approval' : b.status)),
        h('td', null, h('button', { class: 'link', onclick: () => billDetail(b) }, 'Open')))))))
      : h('p', { class: 'empty' }, 'No bills here.');
    main.replaceChildren(
      pageHead('EB bills', 'The admin uploads each bill with its key figures. The owner approves or rejects it.',
        canWrite() ? h('button', { class: 'btn primary', onclick: () => uploadBill(systemsList) }, 'Upload a bill') : null),
      h('section', null, h('h2', null, isOwner() ? 'Waiting for your approval' : 'Waiting for approval'), h('div', { class: 'panel' }, table(waiting))),
      h('section', null, h('h2', null, 'All bills'), h('div', { class: 'panel' }, table(list.filter((b) => b.status !== 'Submitted')))));
  }

  function uploadBill(systemsList) {
    const sys = select('bl-sys', '', [['', 'Choose a site'], ...systemsList.map((s) => [s.id, `${s.site}${s.system ? ' · ' + s.system : ''}`])]);
    sys.required = true;
    const f = {
      service: input('bl-service', ''), billDate: input('bl-date', '', { type: 'date' }),
      from: input('bl-from', '', { type: 'date' }), to: input('bl-to', '', { type: 'date' }),
      imp: input('bl-imp', '', { type: 'number', step: 'any', min: 0 }), exp: input('bl-exp', '', { type: 'number', step: 'any', min: 0 }),
      billed: input('bl-billed', '', { type: 'number', step: 'any', min: 0 }), amount: input('bl-amount', '', { type: 'number', step: 'any', min: 0 }),
      file: input('bl-file', '', { type: 'file', accept: 'application/pdf,image/*', required: true }),
      notes: h('textarea', { id: 'bl-notes' }),
    };
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Submit for approval');
    const num = (el) => (el.value === '' ? null : +el.value);
    const form = h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const file = f.file.files[0];
      if (!file) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const s = systemsList.find((x) => x.id === sys.value);
        const safe = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${sys.value}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('solar-bills').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        await q(sb.from('solar_eb_bills').insert({
          system_id: sys.value, site: `${s.site}${s.system ? ' · ' + s.system : ''}`, service_no: f.service.value.trim() || null,
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
        field('Site', sys, 'wide'), field('Service number', f.service), field('Bill date', f.billDate),
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
    const [rows, sys] = await Promise.all([
      q(sb.from('solar_eb_import').select('*').gte('date', addDays(today(), -45)).order('date')),
      q(sb.from('solar_systems').select('id, site, system, daylight_target_kwh')),
    ]);
    const byId = Object.fromEntries(sys.map((s) => [s.id, s]));
    const ids = [...new Set(rows.map((r) => r.system_id))];
    const head = pageHead('Daylight grid import', `Units taken from EB between ${state.settings.daylight_start || '06:30'} and ${state.settings.daylight_end || '17:30'}. The aim is close to zero. Set a target per system on the Systems page.`);
    if (!ids.length) { main.replaceChildren(head, h('p', { class: 'panel empty' }, 'No grid import has been sent from the sheet yet. It appears after the first nightly sync.')); return; }
    const last = d3.max(rows, (r) => r.date);
    const days = d3.range(13, -1, -1).map((k) => addDays(last, -k));
    main.replaceChildren(head, h('div', { class: 'cards' }, ids.map((id) => {
      const s = byId[id] || { site: id };
      const mine = rows.filter((r) => r.system_id === id);
      const good = mine.filter((r) => r.daylight_kwh != null && !/^Partial/.test(r.note || '')).map((r) => +r.daylight_kwh);
      const usual = good.length ? d3.median(good) : null;
      const latest = mine[mine.length - 1];
      const chart = h('div', { class: 'chart' });
      requestAnimationFrame(() => importChart(chart, mine, days, s.daylight_target_kwh));
      return h('div', { class: 'panel' },
        h('h3', null, s.site), h('p', { class: 'muted' }, s.system || ''),
        h('div', { class: 'card-fig' }, h('span', { class: 'v' }, n1(latest.daylight_kwh)), h('span', { class: 'muted' }, 'units in daylight on ' + fmtDay(latest.date))),
        h('p', { class: 'muted num' }, `Usual ${n1(usual)} · target ${s.daylight_target_kwh == null ? 'not set' : n1(s.daylight_target_kwh)} · whole day ${n1(latest.day_kwh)}`),
        chart);
    })));
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

  /* ---------- systems ---------- */
  const SYS_FIELDS = [
    ['id', 'ID'], ['site', 'Site'], ['system', 'System'], ['type', 'Type', ['On-grid', 'Hybrid', 'Off-grid', 'Grid meter', '']],
    ['rated_kw', 'Rated kW', 'number'], ['tracking', 'Tracking', ['Live', 'Pending', 'Not installed', 'Retired']],
    ['inverters', 'Inverters'], ['panels', 'Panels'], ['panel_kwp', 'Panel kWp', 'number'], ['battery', 'Battery'],
    ['tracked_via', 'Tracked via'], ['source_id', 'Source ID (device or station)'], ['daylight_target_kwh', 'Daylight grid import target (kWh)', 'number'],
    ['spare', 'Spare / excess'], ['open_issue', 'Open issue', 'wide'], ['open_question', 'Open question', 'wide'],
  ];
  async function systems() {
    const list = await q(sb.from('solar_system_status').select('*').order('sort'));
    const tbl = h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['ID', 'Site', 'System', 'Type', 'kW', 'Tracking', 'Tracked via', 'Expected/day', 'Attention'].map((c, i) => h('th', { class: i === 4 || i === 7 ? 'n' : null }, c)))),
      h('tbody', null, list.map((s) => h('tr', { class: 'click', tabindex: 0, onclick: () => editSystem(s), onkeydown: (e) => { if (e.key === 'Enter') editSystem(s); } },
        h('td', null, s.id), h('td', null, s.site), h('td', null, s.system || ''), h('td', null, s.type || ''),
        h('td', { class: 'n' }, s.rated_kw ?? ''), h('td', null, s.tracking), h('td', null, s.tracked_via || ''),
        h('td', { class: 'n' }, n1(s.expected_kwh)),
        h('td', null, s.attention ? h('span', { class: 'chip ' + (s.attention === 'OK' ? 'ok' : s.attention === 'Open item' ? '' : 'bad') }, s.attention) : ''))))));
    main.replaceChildren(pageHead('Systems', 'Every system in the master list. Click a row to edit it. Set Tracking to Live once its readings reach the sheet.',
      canWrite() ? h('button', { class: 'btn primary', onclick: () => editSystem(null) }, 'Add a system') : null), h('section', { class: 'panel' }, tbl));
  }
  function editSystem(s) {
    const isNew = !s;
    const els = {};
    const grid = h('div', { class: 'form-grid' }, SYS_FIELDS.map(([k, label, kind]) => {
      let el;
      if (Array.isArray(kind)) el = select('sy-' + k, s ? s[k] ?? '' : (k === 'tracking' ? 'Pending' : ''), kind);
      else if (kind === 'wide') el = h('textarea', { id: 'sy-' + k }, s ? s[k] || '' : '');
      else el = input('sy-' + k, s ? s[k] : '', kind === 'number' ? { type: 'number', step: 'any' } : {});
      if (k === 'id' && !isNew) el.disabled = true;
      if (!canWrite()) el.disabled = true;
      els[k] = el;
      return field(label, el, kind === 'wide' ? 'wide' : null);
    }));
    const form = h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      const row = {};
      SYS_FIELDS.forEach(([k, , kind]) => { const v = els[k].value.trim(); row[k] = v === '' ? null : kind === 'number' ? +v : v; });
      if (!row.id || !row.site) { toast('ID and site are needed.', true); return; }
      if (isNew) await q(sb.from('solar_systems').insert(row));
      else { delete row.id; await q(sb.from('solar_systems').update(row).eq('id', s.id)); }
      closeDialog(); toast('Saved'); route();
    } },
      h('div', { class: 'dlg-head' }, h('h2', null, isNew ? 'Add a system' : `${s.id} · ${s.site}`), h('button', { type: 'button', class: 'link', onclick: closeDialog }, 'Cancel')),
      grid, canWrite() ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')) : null);
    openDialog(form);
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

  boot();
})();
