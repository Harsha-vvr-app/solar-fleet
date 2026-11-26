/* Spoken Tamil help lines for staff, shown under the English text.
   Turned on and off per browser from the menu ("தமிழ்"). Nothing here changes data. */
(function () {
  'use strict';

  // exact English text -> everyday spoken Tamil
  const T = {
    // menu
    'Dashboard': 'முகப்பு',
    'Checklist': 'பாக்கி வேலை லிஸ்ட்',
    'Energy': 'கரண்ட் கணக்கு',
    'Tickets': 'புகார் & வேலை',
    'EB bills': 'EB பில்',
    'Setup': 'செட்டிங்ஸ்',
    'Sign out': 'வெளியே போ',

    // page descriptions
    "Finish setting up first: get every site's facts in, then get every system and EB line sending daily readings.":
      'முதல்ல எல்லா site விவரமும் போடுங்க. அப்புறம் ஒவ்வொரு solar-உம் EB line-உம் தினமும் reading அனுப்புற மாதிரி செட் பண்ணுங்க.',
    'What is still missing at each site. Click an amber item to fill it in. To add a bill, you can also send the PDF or a photo to Claude.':
      'ஒவ்வொரு site-லயும் இன்னும் என்ன விவரம் பாக்கி இருக்குன்னு இங்க பாக்கலாம். மஞ்சள் கலர்ல இருக்கறத கிளிக் பண்ணி நிரப்புங்க. EB பில்லோட PDF இல்ல போட்டோவ Claude-க்கு அனுப்பினாலும் போதும்.',
    'Every solar system and EB line that does not send daily readings yet, with the reason. Note why, then make a task to fix it.':
      'தினமும் reading வராத solar-உம் EB line-உம் எல்லாம் இங்க இருக்கு. ஏன் வரலைன்னு காரணம் எழுதுங்க, அப்புறம் சரி பண்ண ஒரு வேலை போடுங்க.',
    'Click a ticket to open it. Press Done when the work is finished.':
      'புகார கிளிக் பண்ணா முழு விவரம் வரும். வேலை முடிஞ்சதும் "Done" அழுத்துங்க.',
    'Bills that need you. Click one to approve it or mark it paid.':
      'கவனிக்க வேண்டிய பில் இங்க இருக்கு. கிளிக் பண்ணி approve பண்ணுங்க, இல்லன்னா கட்டியாச்சுன்னு போடுங்க.',
    'One row per site, one column per month. Click a bill to open it, or + to upload one.':
      'ஒவ்வொரு site-க்கும் ஒரு வரி, ஒவ்வொரு மாசத்துக்கும் ஒரு கட்டம். பில்ல கிளிக் பண்ணி பாருங்க, + அழுத்தி புது பில் ஏத்துங்க.',
    'EB used against solar made at each site, from the daily readings. Click a site to see it day by day.':
      'ஒவ்வொரு site-லயும் எவ்ளோ EB கரண்ட் போச்சு, எவ்ளோ solar வந்துச்சுன்னு இங்க பாக்கலாம். Site-அ கிளிக் பண்ணா நாள் வாரியா வரும்.',
    'Lists and settings you need now and then.': 'எப்பவாவது தேவைப்படுற லிஸ்ட்டும் செட்டிங்ஸும்.',
    'Every solar system, by site. Click one to open it.': 'எல்லா solar system-உம் site வாரியா இருக்கு. கிளிக் பண்ணி திறங்க.',

    // buttons
    'New task': 'புது வேலை',
    'New complaint': 'புது புகார்',
    'Raise a complaint': 'புகார் போடுங்க',
    'Raise complaint': 'புகார் போடுங்க',
    'Add a note': 'குறிப்பு எழுதுங்க',
    'Upload a bill': 'பில் ஏத்துங்க',
    'Done': 'முடிஞ்சது',
    'Mark done': 'முடிஞ்சதுன்னு போடுங்க',
    'Resolve': 'சரி பண்ணியாச்சு',
    'Start': 'வேலை ஆரம்பி',
    'Reopen': 'திரும்ப திற',
    'Change due or person': 'தேதி / ஆள் மாத்து',
    'Add reason': 'காரணம் எழுதுங்க',
    'Change reason': 'காரணம் மாத்துங்க',
    'Make a task': 'வேலை போடுங்க',
    'Logger details': 'Logger விவரம்',
    'Save': 'சேவ் பண்ணு',
    'Cancel': 'வேண்டாம்',
    'Add update': 'அப்டேட் போடுங்க',
    'Mark as paid': 'கட்டியாச்சு',
    'Mark as not paid': 'இன்னும் கட்டல',
    'Approve': 'ஓகே பண்ணு',
    'Reject': 'திருப்பி அனுப்பு',
    'Nothing spare here': 'இங்க extra எதுவும் இல்ல',
    'Edit site': 'Site விவரம் மாத்து',
    'Edit system': 'System விவரம் மாத்து',
    'Continue →': 'தொடருங்க →',
    'Submit for approval': 'Approve-க்கு அனுப்பு',
    'Add a system': 'புது system சேர்',
    'Delete site': 'Site-அ நீக்கு',
    'Delete for good': 'நிரந்தரமா நீக்கு',

    // tabs and switches
    'Summary': 'சுருக்கம்',
    'Day by day': 'நாள் வாரியா',
    'Bills': 'பில்',
    'Details': 'விவரம்',
    'Questions': 'கேள்விகள்',
    'Mine': 'என்னோடது',
    'All': 'எல்லாம்',
    'All sites': 'எல்லா site',
    'Needs attention': 'கவனிக்கணும்',
    'All bills': 'எல்லா பில்',
    'Step 1 · Site facts': 'படி 1 · site விவரம்',
    'Step 2 · Daily tracking': 'படி 2 · தினசரி reading',
    'Site facts': 'Site விவரம்',
    'Daily tracking': 'தினசரி reading',
    'Day to day': 'தினசரி நிலவரம்',
    'Tickets and tasks': 'புகார் & வேலை',
    'Sites': 'Site-கள்',
    'Solar': 'Solar',
    'Systems here': 'இங்க இருக்கற system',
    'System here': 'இங்க இருக்கற system',
    'Open': 'பாக்கி இருக்கு',
    'To approve': 'Approve பண்ணணும்',
    'To pay': 'கட்டணும்',

    // states
    'Not tracked': 'Reading வரல',
    'Working': 'நல்லா ஓடுது',
    'Fault': 'கோளாறு',
    'Overdue': 'தேதி தாண்டிடுச்சு',
    'Bill overdue': 'பில் தேதி தாண்டிடுச்சு',
    'Bill due': 'பில் கட்டணும்',
    'Issue open': 'பிரச்சனை இருக்கு',
    'Task open': 'வேலை பாக்கி',
    'No solar': 'Solar இல்ல',
    'Bill to approve': 'பில் approve பண்ணணும்',
    'Reason not noted yet': 'காரணம் இன்னும் எழுதல',
    'Issue': 'பிரச்சனை',
    'Task': 'வேலை',
    'Complaint': 'புகார்',
    'Question': 'கேள்வி',

    // checklist items
    'EB number': 'EB நம்பர்',
    'Recent bill': 'சமீபத்து பில்',
    'Solar details': 'Solar விவரம்',
    'Spare items': 'Extra சாமான்',
  };

  // text that carries a number or a date: match the start, translate the meaning
  const PATTERNS = [
    [/^due \d/, 'கட்ட வேண்டிய தேதி'],
    [/^Open · \d+$/, 'பாக்கி இருக்கு'],
    [/^Done · \d+$/, 'முடிஞ்சது'],
    [/^Questions · \d+$/, 'கேள்விகள்'],
    [/^Not tracked · \d+$/, 'Reading வரல'],
    [/^Tracked · \d+$/, 'Reading வருது'],
    [/^Still missing · \d+$/, 'இன்னும் பாக்கி'],
    [/^Complete · \d+$/, 'முடிஞ்சது'],
    [/^To do · \d+$/, 'செய்ய வேண்டியது'],
    [/^Stopped/, 'Reading நின்னுடுச்சு'],
    [/^Reporting/, 'Reading வருது'],
    [/^Set up, but no readings yet/, 'செட் பண்ணியாச்சு, ஆனா reading வரல'],
    [/^overdue · /, 'தேதி தாண்டிடுச்சு'],
    [/^due /, 'கட்டணும் / முடிக்கணும்'],
    [/^\d+ need(s)? attention/, 'கவனிக்கணும்'],
    [/^\d+ overdue$/, 'தேதி தாண்டிடுச்சு'],
    [/sites fully filled in$/, 'site விவரம் முழுசா போட்டாச்சு'],
    [/solar systems and EB lines sending readings$/, 'reading அனுப்புற solar & EB line'],
    [/^Next: /, 'அடுத்து இதை முடிங்க'],
    [/^Still to set up at /, 'இந்த site-கள்ல reading இன்னும் செட் பண்ணணும்'],
  ];

  const SEL = 'nav.side a, nav.side button, .page-head p, .page-head h1, button, .seg, .ck-st, .ck-why > span, .ck-pill, .dg-state, .tk-kind, .tile-l, .step-top h2, .step-go, .step-next, .tile-s, .dash-sub, .dg-head h2, .side-panel h3, .panel > h3, .sec-head h2, .tk-due';

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.replace(/\s+/g, ' ').trim().replace(/^✓\s*/, '');
  }
  function lookup(text) {
    if (!text) return null;
    if (T[text]) return T[text];
    for (const [re, ta] of PATTERNS) if (re.test(text)) return ta;
    return null;
  }
  function mark(root) {
    if (!on || !root || root.nodeType !== 1) return;
    const els = root.matches && root.matches(SEL) ? [root, ...root.querySelectorAll(SEL)] : [...root.querySelectorAll(SEL)];
    for (const el of els) {
      if (el.closest('.ta') || el.querySelector(':scope > .ta')) continue;
      const ta = lookup(ownText(el));
      if (!ta) continue;
      const span = document.createElement('span');
      span.className = 'ta'; span.lang = 'ta'; span.textContent = ta;
      el.appendChild(span);
    }
  }
  function clear() { document.querySelectorAll('.ta').forEach((n) => n.remove()); }

  let on = false;
  const KEY = 'solar-fleet-tamil';
  const obs = new MutationObserver((list) => {
    if (!on) return;
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && !n.classList.contains('ta')) mark(n);
  });

  function set(v) {
    on = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private window: keep it for this visit only */ }
    document.documentElement.classList.toggle('show-ta', v);
    const b = document.getElementById('ta-toggle');
    if (b) { b.setAttribute('aria-pressed', String(v)); b.firstChild.textContent = v ? 'தமிழ் விளக்கம்: இருக்கு' : 'தமிழ் விளக்கம்: இல்ல'; }
    clear();
    if (v) mark(document.body);
  }

  window.SolarTamil = {
    start(defaultOn) {
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
      obs.observe(document.body, { childList: true, subtree: true });
      set(saved === null ? !!defaultOn : saved === '1');
    },
    toggle() { set(!on); },
  };
})();
