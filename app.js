(() => {
  'use strict';

  const VERSION = 1;
  const STORE = 'unity_pwa_state_v1';
  const TYPES = ['Deload', 'Maintenance', 'Development', 'Stress'];
  const TYPE_PCT = { Deload: .15, Maintenance: .22, Development: .28, Stress: .35 };
  const SPLITS = { Deload: [.15, .35, .5], Maintenance: [.15, .22, .28, .35], Development: [.15, .22, .28, .35], Stress: [.1, .15, .2, .25, .3] };
  const PATTERNS = ['Push', 'Pull', 'Squat', 'Lunge', 'Hinge', 'Rotation', 'Anti-Rotation', 'Loaded Carry'];
  const LIBRARY = {
    Push: { main: 'Military Press', acc: ['Double Push Press', 'Half-Kneeling Press', 'Bridge Floor Press'] },
    Pull: { main: 'Double Clean', acc: ['Pull-up / Chin-up', 'Wide Row', 'Small Row'] },
    Squat: { main: 'Double Front Squat', acc: ['Box Pistol', 'Step-up', 'Goblet Squat'] },
    Lunge: { main: 'Double Reverse Lunge', acc: ['Tactical Lunge', 'Bulgarian Split Squat', 'Clean + Reverse Lunge'] },
    Hinge: { main: 'Two-arm Swing', acc: ['Single-leg Glute Bridge', 'Double Deadlift', 'Double Snatch'] },
    Rotation: { main: 'Turkish Get Up', acc: ['Windmill', 'Half-kneeling Lift', 'Bent Press'] },
    'Anti-Rotation': { main: 'Snatch', acc: ['One-arm Swing', 'Single-leg Deadlift', 'Renegade Row'] },
    'Loaded Carry': { main: 'Suitcase Carry', acc: ['Front Rack Carry', 'Overhead Carry', 'Bear Crawl'] }
  };
  const BALLISTIC = /swing|snatch|double clean|push press/i;
  const UNILATERAL = /one-arm|single-leg|split|pistol|step-up|lunge|windmill|bent press|half-kneeling|renegade|pull-up|chin-up|military press|push press|snatch/i;
  const DEFAULTS = {
    baseKB: 20, volume: 180, autoProgression: true, bias: true, weekMode: 'balanced',
    strengthFocus: '', strengthReps: 180, barbellMode: false,
    barbell: { Push: 'Barbell Bench Press', Pull: 'Barbell Row', Squat: 'Back Squat', Hinge: 'Deadlift' }
  };
  const TESTS = [
    { id: 'swing', name: 'One-arm Swing', target: '10 / side', sides: true, min: 10 },
    { id: 'clean', name: 'Double Clean', target: '5 total', min: 5 },
    { id: 'press', name: 'Press', target: '5 / side', sides: true, min: 5 },
    { id: 'squat', name: 'Double Front Squat', target: '5 total', min: 5 },
    { id: 'snatch', name: 'Snatch', target: '5 / side', sides: true, min: 5 },
    { id: 'getup', name: 'Turkish Get Up', target: '1 / side', sides: true, min: 1 },
    { id: 'snatch100', name: 'Snatch Test', target: '100 under 5:00', min: 100, timer: true }
  ];

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaultState = () => ({ version: VERSION, mode: 'setup', settings: clone(DEFAULTS), seed: null, plan: null, cursor: 0, completed: {}, counters: {}, cycle: 1, tests: [] });
  let state = loadState();
  let setupStep = 0;
  let importedSeed = null;
  let editing = false;
  let installPrompt = null;
  let timerSeconds = 0;
  let timerHandle = null;

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE));
      if (!value || value.version !== VERSION) return defaultState();
      value.settings = mergeSettings(value.settings);
      return value;
    } catch (_) { return defaultState(); }
  }
  function mergeSettings(value = {}) {
    return { ...clone(DEFAULTS), ...value, barbell: { ...DEFAULTS.barbell, ...(value.barbell || {}) } };
  }
  function save() { localStorage.setItem(STORE, JSON.stringify(state)); }
  function randomSeed() {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `${values[0].toString(36)}${values[1].toString(36)}`;
  }
  function hash(text) {
    let h = 2166136261;
    for (const char of String(text)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFrom(seed) {
    let h = hash(seed);
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(array, rng) {
    const out = array.slice();
    for (let i = out.length - 1; i; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  function roundsFor(volume) {
    if (+volume === 180) return { rounds: 3, cap: 3, heavy: 1 };
    if (+volume === 240) return { rounds: 3, cap: 4, heavy: 2 };
    if (+volume === 300) return { rounds: 3, cap: 5, heavy: 3 };
    if (+volume === 400) return { rounds: 4, cap: 5, heavy: 3 };
    return { rounds: 5, cap: 5, heavy: 3 };
  }
  function allocate(total, weights, quantum = 1) {
    const units = Math.max(weights.length, Math.round(total / quantum));
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map(w => units * w / sum);
    const values = raw.map(v => Math.max(1, Math.floor(v)));
    let diff = units - values.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
    let p = 0;
    while (diff > 0) { values[order[p++ % order.length].i]++; diff--; }
    while (diff < 0) { const item = order.slice().reverse()[p++ % order.length]; if (values[item.i] > 1) { values[item.i]--; diff++; } }
    return values.map(v => v * quantum);
  }

  function weekOrders(settings, rng) {
    const result = {};
    if (settings.weekMode === 'balanced') {
      const offsets = shuffle([0, 0, 1, 1, 2, 2, 3, 3], rng);
      shuffle(PATTERNS, rng).forEach((pattern, i) => { result[pattern] = TYPES.map((_, week) => TYPES[(week + offsets[i]) % 4]); });
    } else {
      PATTERNS.forEach(pattern => { result[pattern] = shuffle(TYPES, rng); });
    }
    return result;
  }

  function buildEntries(settings, orders, week, rng) {
    const rc = roundsFor(settings.volume);
    const source = [];
    PATTERNS.forEach(pattern => {
      if (pattern === settings.strengthFocus) return;
      const type = orders[pattern][week];
      const weights = SPLITS[type];
      const volumes = allocate(Math.round(settings.volume * TYPE_PCT[type]), weights, rc.rounds);
      const min = Math.min(...weights), max = Math.max(...weights);
      const items = weights.map((pct, i) => ({ pattern, type, volume: volumes[i], intensity: !settings.bias ? 'Base' : pct === min ? 'Heavy' : pct === max ? 'Light' : 'Base' }));
      source.push({ pattern, items: shuffle(items, rng) });
    });

    let best = null;
    for (let attempt = 0; attempt < 180; attempt++) {
      const days = Array.from({ length: 5 }, () => []);
      source.forEach(group => {
        const picks = shuffle([0, 1, 2, 3, 4], rng).slice(0, group.items.length);
        group.items.forEach((entry, i) => days[picks[i]].push(entry));
      });
      const totals = days.map(day => day.reduce((sum, e) => sum + e.volume, 0));
      const mean = totals.reduce((a, b) => a + b, 0) / 5;
      const heavy = days.map(day => day.filter(e => e.intensity === 'Heavy').length);
      const score = totals.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) + heavy.reduce((sum, n) => sum + Math.max(0, n - 2) * 5000, 0);
      if (!best || score < best.score) best = { score, days };
    }
    return best.days;
  }

  function displayReps(name, count) {
    const shown = BALLISTIC.test(name) ? count * 2 : count;
    return UNILATERAL.test(name) ? `${shown} + ${shown}` : String(shown);
  }
  function entryExercises(entry, settings, rc, rng, idBase) {
    if (entry.pattern === 'Loaded Carry') {
      const choices = [LIBRARY[entry.pattern].main, ...LIBRARY[entry.pattern].acc];
      return [{ id: `${idBase}-carry`, name: choices[Math.floor(rng() * choices.length)], detail: `${Math.max(30, entry.volume * 5)} sec`, rounds: 1, intensity: entry.intensity, weight: entry.intensity === 'Heavy' ? settings.baseKB + 4 : entry.intensity === 'Light' ? Math.max(4, settings.baseKB - 4) : settings.baseKB, carry: true }];
    }
    const lib = LIBRARY[entry.pattern];
    let main = lib.main;
    const isBarbell = settings.barbellMode && entry.intensity === 'Heavy' && settings.barbell[entry.pattern];
    if (isBarbell) main = settings.barbell[entry.pattern];
    const standard = Math.min(entry.volume, rc.cap * rc.rounds);
    let assigned = standard;
    if (settings.bias && entry.intensity === 'Heavy') assigned = Math.min(entry.volume, rc.heavy * rc.rounds);
    if (settings.bias && entry.intensity === 'Light') assigned = Math.min(entry.volume, standard * 2);
    const weight = isBarbell ? 'Barbell' : entry.intensity === 'Heavy' ? settings.baseKB + 4 : entry.intensity === 'Light' ? Math.max(4, settings.baseKB - 4) : settings.baseKB;
    const exercises = [];
    if (assigned > 0) exercises.push({ id: `${idBase}-m`, name: main, detail: `${displayReps(main, Math.max(1, Math.floor(assigned / rc.rounds)))} reps`, rounds: rc.rounds, intensity: entry.intensity, weight });
    let remaining = entry.volume - assigned;
    const accessories = shuffle(lib.acc, rng);
    let index = 0;
    while (remaining >= rc.rounds && index < accessories.length) {
      const name = accessories[index++];
      const amount = Math.min(remaining, rc.cap * rc.rounds);
      const perRound = Math.max(1, Math.floor(amount / rc.rounds));
      const used = perRound * rc.rounds;
      exercises.push({ id: `${idBase}-a${index}`, name, detail: `${displayReps(name, perRound)} reps`, rounds: rc.rounds, intensity: 'Base', weight: settings.baseKB });
      remaining -= used;
    }
    return exercises;
  }

  function generatePlan(settings, seed) {
    const rng = rngFrom(`${VERSION}:${seed}`);
    const orders = weekOrders(settings, rng);
    const rc = roundsFor(settings.volume);
    const days = [];
    for (let week = 0; week < 4; week++) {
      const weekDays = buildEntries(settings, orders, week, rng);
      for (let day = 0; day < 5; day++) {
        const exercises = [];
        weekDays[day].forEach((entry, i) => exercises.push(...entryExercises(entry, settings, rc, rng, `w${week}d${day}e${i}`)));
        days.push({ week, day, exercises: shuffle(exercises, rng), types: [...new Set(weekDays[day].map(e => e.type))] });
      }
    }
    if (settings.strengthFocus) addStrengthFocus(days, settings, rng);
    return { version: VERSION, seed, orders, rounds: rc.rounds, days };
  }

  function addStrengthFocus(days, settings, rng) {
    const focusTypes = ['Deload', 'Development', 'Maintenance', 'Stress'];
    for (let week = 0; week < 4; week++) {
      const total = Math.round(settings.strengthReps * TYPE_PCT[focusTypes[week]]);
      const volumes = allocate(total, [.5, .35, .15], 1);
      const candidates = shuffle([0, 1, 2, 3, 4], rng).slice(0, 3);
      volumes.forEach((volume, i) => {
        const target = days[week * 5 + candidates[i]];
        const name = LIBRARY[settings.strengthFocus].main;
        target.exercises.unshift({ id: `focus-w${week}-${i}`, name, detail: `${volume} total reps`, rounds: 1, intensity: 'Focus', weight: settings.baseKB, focus: true });
      });
    }
  }

  function readSettings() {
    const radio = name => $(`input[name="${name}"]:checked`).value;
    return mergeSettings({
      baseKB: +$('#baseKB').value,
      volume: +radio('volume'),
      autoProgression: $('#autoProgression').checked,
      bias: radio('bias') === 'on',
      weekMode: radio('weekMode'),
      strengthFocus: $('#strengthFocus').value,
      strengthReps: +$('#strengthReps').value,
      barbellMode: $('#barbellMode').checked,
      barbell: { Push: $('#barbellPush').value.trim(), Pull: $('#barbellPull').value.trim(), Squat: $('#barbellSquat').value.trim(), Hinge: $('#barbellHinge').value.trim() }
    });
  }
  function fillSettings(settings) {
    $('#baseKB').value = settings.baseKB;
    $(`input[name="volume"][value="${settings.volume}"]`)?.click();
    $('#autoProgression').checked = settings.autoProgression;
    $(`input[name="bias"][value="${settings.bias ? 'on' : 'off'}"]`)?.click();
    $(`input[name="weekMode"][value="${settings.weekMode}"]`)?.click();
    $('#strengthFocus').value = settings.strengthFocus;
    $('#strengthReps').value = settings.strengthReps;
    $('#barbellMode').checked = settings.barbellMode;
    Object.entries(settings.barbell).forEach(([key, value]) => $(`#barbell${key}`).value = value);
    syncConditionalFields();
  }
  function syncConditionalFields() {
    $('#strengthFields').hidden = !$('#strengthFocus').value;
    $('#barbellFields').hidden = !$('#barbellMode').checked;
  }
  function renderSetupStep() {
    const titles = ['Choose your starting point', 'Shape the training week', 'Choose a strength focus', 'Configure heavy work', 'Review your program'];
    $$('.setup-step').forEach((step, i) => step.classList.toggle('active', i === setupStep));
    $('#setupTitle').textContent = titles[setupStep];
    $('#stepLabel').textContent = `${setupStep + 1} / 5`;
    $('#stepProgress').style.width = `${(setupStep + 1) * 20}%`;
    $('#setupBack').hidden = setupStep === 0;
    $('#setupNext').textContent = setupStep === 4 ? (editing ? 'Create new block' : 'Start program') : 'Continue';
    if (setupStep === 4) renderReview();
  }
  function renderReview() {
    const s = readSettings();
    const rows = [
      ['Goldilocks bell', `${s.baseKB} kg`], ['Block', `${s.volume} reps`], ['KB Bias', s.bias ? 'On' : 'Off'],
      ['Weeks', s.weekMode === 'balanced' ? 'Balanced' : 'Chaos'], ['Strength focus', s.strengthFocus ? `${s.strengthFocus} · ${s.strengthReps}` : 'None'],
      ['Heavy work', s.barbellMode ? 'Barbell Mode' : 'Kettlebell'], ['Progression', s.autoProgression ? 'Auto' : 'Manual']
    ];
    $('#setupReview').innerHTML = rows.map(([a,b]) => `<div class="review-row"><span>${a}</span><b>${esc(b)}</b></div>`).join('');
  }
  function startProgram() {
    const settings = readSettings();
    if (!settings.baseKB || settings.baseKB < 4) return toast('Enter a valid bell weight');
    if (editing && state.plan && !confirm('Create a new block and replace the current sessions?')) return;
    state.settings = settings;
    state.seed = importedSeed || randomSeed();
    state.plan = generatePlan(settings, state.seed);
    state.cursor = 0;
    state.completed = {};
    state.counters = {};
    state.mode = 'active';
    importedSeed = null;
    editing = false;
    save();
    showView('train');
  }

  function showView(name) {
    const setup = name === 'setup';
    const skill = name === 'skill';
    $$('.view').forEach(view => view.hidden = view.id !== `${name}View`);
    $('#topbar').hidden = setup;
    $('#bottomNav').hidden = setup || skill;
    $$('#bottomNav button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'train') renderTrain();
    if (name === 'skill') renderSkill();
    if (name === 'progress') renderProgress();
    $('#cycleChip').textContent = `CYCLE ${state.cycle}`;
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderTrain() {
    if (!state.plan) return showView('setup');
    const day = state.plan.days[state.cursor];
    $('#sessionEyebrow').textContent = `WEEK ${day.week + 1} · DAY ${day.day + 1}`;
    $('#sessionTitle').textContent = state.completed[state.cursor] ? 'Session complete' : 'Today';
    $('#prevDay').disabled = state.cursor === 0;
    $('#nextDay').disabled = state.cursor === state.plan.days.length - 1;
    const counts = day.exercises.reduce((out, e) => { out[e.intensity] = (out[e.intensity] || 0) + 1; return out; }, {});
    const meta = [`${state.settings.volume} block`, `${state.plan.rounds} rounds`, ...Object.keys(counts).filter(k => k !== 'Base').map(k => k)];
    $('#sessionMeta').innerHTML = meta.map(m => `<span class="meta-pill ${m.toLowerCase()}">${esc(m)}</span>`).join('');
    const carry = day.exercises.find(e => e.carry);
    const regular = day.exercises.filter(e => !e.carry);
    $('#exerciseList').innerHTML = regular.map(exerciseHTML).join('') || '<div class="exercise-row"><div><h3>Recovery day</h3></div></div>';
    $('#carryLine').hidden = !carry;
    if (carry) $('#carryLine').innerHTML = `<b>${esc(carry.name)}</b> · ${esc(carry.detail)} · ${carry.weight} kg`;
    const button = $('#completeSession');
    button.textContent = state.completed[state.cursor] ? 'Completed ✓' : 'Complete session';
    button.classList.toggle('done', !!state.completed[state.cursor]);
    $$('.rep-counter button').forEach(button => button.addEventListener('click', changeCounter));
  }
  function exerciseHTML(exercise) {
    const current = state.counters[exercise.id] || 0;
    const label = exercise.weight === 'Barbell' ? 'Barbell' : `${exercise.weight} kg`;
    return `<div class="exercise-row ${current >= exercise.rounds ? 'done' : ''}"><div><h3>${esc(exercise.name)}</h3><p>${esc(exercise.detail)} · ${esc(label)}${exercise.intensity !== 'Base' ? ` · ${esc(exercise.intensity)}` : ''}</p></div><div class="rep-counter" data-id="${esc(exercise.id)}" data-max="${exercise.rounds}"><button type="button" data-delta="-1">−</button><span>${current}/${exercise.rounds}</span><button type="button" data-delta="1">+</button></div></div>`;
  }
  function changeCounter(event) {
    const box = event.currentTarget.closest('.rep-counter');
    const id = box.dataset.id, max = +box.dataset.max, delta = +event.currentTarget.dataset.delta;
    state.counters[id] = Math.max(0, Math.min(max, (state.counters[id] || 0) + delta));
    save(); renderTrain();
  }
  function completeSession() {
    if (state.completed[state.cursor]) return;
    state.completed[state.cursor] = true;
    const finished = Object.keys(state.completed).length === state.plan.days.length;
    if (finished) {
      state.mode = 'skill';
      save();
      showView('skill');
      return;
    }
    let next = state.cursor + 1;
    while (next < state.plan.days.length && state.completed[next]) next++;
    if (next >= state.plan.days.length) next = state.plan.days.findIndex((_, i) => !state.completed[i]);
    state.cursor = Math.max(0, next);
    save(); renderTrain(); scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderSkill() {
    $('#skillBell').textContent = `${state.settings.baseKB + 4} kg`;
    $('#skillForm').innerHTML = TESTS.map(test => {
      const inputs = test.sides
        ? `<div class="test-inputs"><label>Left<input type="number" min="0" max="200" data-test="${test.id}" data-side="left" required></label><label>Right<input type="number" min="0" max="200" data-test="${test.id}" data-side="right" required></label></div>`
        : `<div class="test-inputs one"><label>Reps<input type="number" min="0" max="300" data-test="${test.id}" data-side="reps" required></label></div>`;
      const timer = test.timer ? `<div class="timer"><div class="timer-output" id="timerOutput">00:00</div><button type="button" id="timerToggle">Start</button><button type="button" id="timerReset">Reset</button></div>` : '';
      return `<div class="test-item"><div class="test-head"><b>${test.name}</b><span>${test.target}</span></div>${inputs}${timer}</div>`;
    }).join('');
    timerSeconds = 0; clearInterval(timerHandle); timerHandle = null;
    $('#timerToggle').addEventListener('click', toggleTimer);
    $('#timerReset').addEventListener('click', resetTimer);
  }
  function timerText() { return `${String(Math.floor(timerSeconds / 60)).padStart(2,'0')}:${String(timerSeconds % 60).padStart(2,'0')}`; }
  function toggleTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; $('#timerToggle').textContent = 'Start'; }
    else { timerHandle = setInterval(() => { timerSeconds++; $('#timerOutput').textContent = timerText(); }, 1000); $('#timerToggle').textContent = 'Stop'; }
  }
  function resetTimer() { clearInterval(timerHandle); timerHandle = null; timerSeconds = 0; $('#timerOutput').textContent = '00:00'; $('#timerToggle').textContent = 'Start'; }
  function finishSkill() {
    const result = {};
    for (const test of TESTS) {
      const inputs = $$(`[data-test="${test.id}"]`);
      if (inputs.some(input => input.value === '')) return toast('Complete every test');
      result[test.id] = Object.fromEntries(inputs.map(input => [input.dataset.side, +input.value]));
    }
    if (!timerSeconds) return toast('Record the snatch time');
    result.snatch100.seconds = timerSeconds;
    const passed = TESTS.every(test => test.sides
      ? result[test.id].left >= test.min && result[test.id].right >= test.min
      : result[test.id].reps >= test.min && (!test.timer || result[test.id].seconds < 300));
    clearInterval(timerHandle); timerHandle = null;
    state.tests.unshift({ date: new Date().toISOString(), bell: state.settings.baseKB + 4, volume: state.settings.volume, passed, result });
    const next = clone(state.settings);
    if (passed) { next.baseKB += 4; next.volume = 180; }
    else next.volume = ({180:240,240:300,300:400,400:500,500:500})[next.volume] || 240;
    state.pendingSettings = next;
    save();
    $('#resultMark').textContent = passed ? '✓' : '↗';
    $('#resultTitle').textContent = passed ? 'Next bell earned' : 'Build more volume';
    $('#resultText').textContent = passed ? `${next.baseKB} kg · 180 block` : `${next.baseKB} kg · ${next.volume} block`;
    $('#resultContinue').textContent = next.autoProgression ? 'Start next block' : 'Review next block';
    $('#resultDialog').showModal();
  }
  function continueAfterSkill() {
    $('#resultDialog').close();
    state.settings = mergeSettings(state.pendingSettings);
    delete state.pendingSettings;
    state.cycle += 1;
    fillSettings(state.settings);
    if (state.settings.autoProgression) {
      state.seed = randomSeed();
      state.plan = generatePlan(state.settings, state.seed);
      state.cursor = 0; state.completed = {}; state.counters = {}; state.mode = 'active';
      save(); showView('train');
    } else {
      state.mode = 'setup'; state.plan = null; state.completed = {}; state.counters = {};
      save(); setupStep = 4; renderSetupStep(); showView('setup');
    }
  }

  function renderProgress() {
    const completed = Object.keys(state.completed).length;
    const stats = [['Bell', `${state.settings.baseKB} kg`], ['Block', state.settings.volume], ['Sessions', `${completed} / 20`]];
    $('#progressStats').innerHTML = stats.map(([a,b]) => `<div class="stat"><span>${a}</span><b>${b}</b></div>`).join('');
    $('#testHistory').innerHTML = state.tests.length ? state.tests.map(test => `<div class="history-row"><div><b>${test.passed ? 'Passed' : 'Build volume'}</b><br><small>${new Date(test.date).toLocaleDateString()}</small></div><div>${test.bell} kg<br><small>${test.volume} block</small></div></div>`).join('') : '<p class="empty">No skill tests yet.</p>';
  }

  function encodePlan(recipe) {
    const bytes = new TextEncoder().encode(JSON.stringify(recipe));
    let binary = ''; bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodePlan(value) {
    const base = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base + '='.repeat((4 - base.length % 4) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  }
  async function sharePlan() {
    if (!state.plan) return;
    const code = encodePlan({ v: VERSION, seed: state.seed, settings: state.settings });
    const url = `${location.origin}${location.pathname}?plan=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Unity Plan', text: 'Train this Unity block with me.', url });
      else { await navigator.clipboard.writeText(url); toast('Plan link copied'); }
    } catch (error) { if (error.name !== 'AbortError') toast('Could not share plan'); }
  }
  function readImportedPlan() {
    const code = new URLSearchParams(location.search).get('plan');
    if (!code) return false;
    try {
      const recipe = decodePlan(code);
      if (recipe.v !== VERSION || !recipe.seed || !recipe.settings) throw new Error('version');
      const settings = mergeSettings(recipe.settings);
      fillSettings(settings);
      importedSeed = recipe.seed;
      setupStep = 4;
      $('#importAnother').hidden = false;
      history.replaceState({}, '', location.pathname);
      return true;
    } catch (_) { toast('This plan link is not valid'); return false; }
  }
  function resetProgram() {
    if (!confirm('Reset the program and clear all progress?')) return;
    const settings = mergeSettings(state.settings);
    state = defaultState();
    state.settings = settings;
    localStorage.removeItem(STORE);
    fillSettings(settings);
    setupStep = 0; editing = false; renderSetupStep(); showView('setup');
  }

  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 1800);
  }
  function bind() {
    $('#setupNext').addEventListener('click', () => { if (setupStep < 4) { setupStep++; renderSetupStep(); } else startProgram(); });
    $('#setupBack').addEventListener('click', () => { setupStep = Math.max(0, setupStep - 1); renderSetupStep(); });
    $('#strengthFocus').addEventListener('change', syncConditionalFields);
    $('#barbellMode').addEventListener('change', syncConditionalFields);
    $('#prevDay').addEventListener('click', () => { state.cursor = Math.max(0, state.cursor - 1); save(); renderTrain(); });
    $('#nextDay').addEventListener('click', () => { state.cursor = Math.min(state.plan.days.length - 1, state.cursor + 1); save(); renderTrain(); });
    $('#completeSession').addEventListener('click', completeSession);
    $('#finishSkill').addEventListener('click', finishSkill);
    $('#resultContinue').addEventListener('click', continueAfterSkill);
    $$('#bottomNav button,[data-view]').forEach(button => button.addEventListener('click', () => { const target = button.dataset.view; if (target) showView(target); }));
    $('#sharePlan').addEventListener('click', sharePlan);
    $('#sharePlanSettings').addEventListener('click', sharePlan);
    $('#editProgram').addEventListener('click', () => { editing = true; fillSettings(state.settings); setupStep = 0; renderSetupStep(); showView('setup'); });
    $('#resetProgram').addEventListener('click', resetProgram);
    $('#importAnother').addEventListener('click', () => { importedSeed = null; $('#importAnother').hidden = true; fillSettings(DEFAULTS); setupStep = 0; renderSetupStep(); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#installButton').hidden = false; });
    $('#installButton').addEventListener('click', async () => { if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installButton').hidden = true; } });
  }
  function init() {
    bind();
    fillSettings(state.settings);
    const imported = readImportedPlan();
    renderSetupStep();
    if (imported || state.mode === 'setup' || !state.plan) showView('setup');
    else if (state.mode === 'skill') showView('skill');
    else showView('train');
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js');
  }

  window.UnityApp = { generatePlan, weekOrders, encodePlan, decodePlan, roundsFor, VERSION };
  init();
})();
