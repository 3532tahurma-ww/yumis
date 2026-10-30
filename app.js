'use strict';

const STORE_KEY = 'yumis-data-v2';
const OLD_STORE_KEY = 'yumis-data-v1';
const TYPES = [
  { key: 'adj',  label: 'Sıfat' },
  { key: 'noun', label: 'İsim' },
  { key: 'adv',  label: 'Zarf' },
  { key: 'verb', label: 'Fiil' },
];
const TYPE_KEYS = TYPES.map((t) => t.key);
const DEFAULT_SETS = window.YUMIS_DEFAULT_SETS || [];
const DEFAULTS_VERSION = window.YUMIS_DEFAULTS_VERSION || 1;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const lower = (s) => s.toLocaleLowerCase('tr');
const typeLabel = (key) => TYPES.find((t) => t.key === key)?.label || key;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- Data ---------- */
function normalizeSet(s) {
  const words = Array.isArray(s?.words) ? s.words : [];
  return {
    id: s.id ? String(s.id) : uid(),
    name: String(s.name || 'Adsız').trim() || 'Adsız',
    type: TYPE_KEYS.includes(s.type) ? s.type : 'noun',
    words: [...new Set(words.map((w) => String(w).trim()).filter(Boolean))],
  };
}

function normalizeNote(n) {
  return {
    id: n.id ? String(n.id) : uid(),
    date: n.date || new Date().toISOString(),
    words: Array.isArray(n.words)
      ? n.words.filter((w) => w && w.w).map((w) => ({ t: String(w.t), w: String(w.w), s: w.s ? String(w.s) : '' }))
      : [],
    text: String(n.text || ''),
  };
}

// v1 format: topics[{ name, words: { noun, adj, verb, adv } }] → one set per topic and type
function topicsToSets(topics) {
  const out = [];
  for (const t of topics || []) {
    for (const key of TYPE_KEYS) {
      const words = t?.words?.[key];
      if (Array.isArray(words) && words.length) out.push(normalizeSet({ name: t.name, type: key, words }));
    }
  }
  return out;
}

// Merges incoming sets into target by name + type; returns sets that were newly added.
function mergeSets(target, incoming) {
  const added = [];
  for (const s of incoming) {
    const ex = target.find((x) => x.type === s.type && lower(x.name) === lower(s.name));
    if (ex) ex.words = [...new Set([...ex.words, ...s.words])];
    else { target.push(s); added.push(s); }
  }
  return added;
}

const defaultSets = () => DEFAULT_SETS.map((s) => normalizeSet(s));
const basePrefs = () => ({ counts: { adj: 1, noun: 2, adv: 1, verb: 1 }, selected: [], shuffle: false });

function defaultData() {
  const sets = defaultSets();
  const prefs = basePrefs();
  prefs.selected = sets.filter((s) => s.name === 'Genel').map((s) => s.id);
  return { version: 2, defaultsVersion: DEFAULTS_VERSION, sets, notes: [], prefs };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const base = basePrefs();
      const sets = (d.sets || []).map(normalizeSet);
      if ((d.defaultsVersion || 0) < DEFAULTS_VERSION) mergeSets(sets, defaultSets());
      return {
        version: 2,
        defaultsVersion: DEFAULTS_VERSION,
        sets,
        notes: (d.notes || []).map(normalizeNote),
        prefs: { ...base, ...d.prefs, counts: { ...base.counts, ...(d.prefs?.counts || {}) } },
      };
    }
    const old = localStorage.getItem(OLD_STORE_KEY);
    if (old) {
      const d = JSON.parse(old);
      const migrated = defaultData();
      const sets = topicsToSets(d.topics);
      mergeSets(sets, defaultSets());
      migrated.sets = sets;
      migrated.notes = (d.notes || []).map(normalizeNote);
      migrated.prefs.counts = { ...migrated.prefs.counts, ...(d.prefs?.counts || {}) };
      migrated.prefs.selected = sets.filter((s) => s.name === 'Genel').map((s) => s.id);
      return migrated;
    }
  } catch { /* fall through to defaults */ }
  return defaultData();
}

let data = load();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(data));
save();

const setById = (id) => data.sets.find((s) => s.id === id);
const setsOfType = (type) => data.sets.filter((s) => s.type === type);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------- Tabs ---------- */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === btn.dataset.tab));
  if (btn.dataset.tab === 'gen') renderGen();
  if (btn.dataset.tab === 'notes') renderNotes();
});

/* ---------- Generator ---------- */
let current = []; // { t: type, w: word, s: set id }

function renderGen() {
  const ids = new Set(data.sets.map((s) => s.id));
  data.prefs.selected = data.prefs.selected.filter((id) => ids.has(id));

  const box = $('#genSets');
  box.innerHTML = '';
  for (const { key, label } of TYPES) box.append(renderSetGroup(key, label));

  const counts = $('#counts');
  counts.innerHTML = '';
  for (const { key, label } of TYPES) {
    const c = el('div', 'count t-' + key);
    c.append(el('label', null, label));
    const st = el('div', 'stepper');
    const minus = el('button', null, '−');
    const val = el('span', null, data.prefs.counts[key]);
    const plus = el('button', null, '+');
    const set = (n) => { data.prefs.counts[key] = Math.max(0, Math.min(20, n)); val.textContent = data.prefs.counts[key]; save(); };
    minus.onclick = () => set(data.prefs.counts[key] - 1);
    plus.onclick = () => set(data.prefs.counts[key] + 1);
    st.append(minus, val, plus);
    c.append(st);
    counts.append(c);
  }
  $('#shuffleAll').checked = !!data.prefs.shuffle;
  renderAddSelect();
  renderResult();
}

// Collapsible one-line summary per type; expands to a searchable list of set pills.
const openTypes = new Set();

function renderSetGroup(key, label) {
  const sets = setsOfType(key);
  const isOn = (s) => data.prefs.selected.includes(s.id);
  const group = el('details', 'set-group');
  group.open = openTypes.has(key);
  group.ontoggle = () => (group.open ? openTypes.add(key) : openTypes.delete(key));

  const summary = el('summary');
  const info = el('span', 'sel-info');
  const count = el('span', 'sel-count');
  summary.append(el('span', 'badge t-' + key, label), info, count);
  const updateSummary = () => {
    const on = sets.filter(isOn);
    info.textContent = on.length ? on.map((s) => s.name).join(', ') : 'seçili küme yok';
    count.textContent = `${on.length}/${sets.length}`;
  };
  updateSummary();
  group.append(summary);

  const body = el('div', 'group-body');
  const tools = el('div', 'group-tools');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Küme ara...';
  const all = el('button', 'link', 'tümü');
  const none = el('button', 'link', 'hiçbiri');
  const add = el('button', 'link', '＋ yeni');
  add.onclick = () => { if (createSet(key)) renderGen(); };
  const edit = el('button', 'link', '✎ düzenle');
  edit.onclick = () => {
    activeType = key;
    activeSetId = null;
    document.querySelector('#tabs [data-tab="sets"]').click();
    renderSets();
  };
  tools.append(search, all, none, add, edit);

  const pills = el('div', 'pills');
  const buttons = sets.map((s) => {
    const b = el('button', 'pill' + (isOn(s) ? ' on' : ''), s.name);
    b.onclick = () => {
      const sel = data.prefs.selected;
      data.prefs.selected = isOn(s) ? sel.filter((x) => x !== s.id) : [...sel, s.id];
      b.classList.toggle('on', isOn(s));
      save();
      updateSummary();
    };
    pills.append(b);
    return b;
  });
  if (!sets.length) pills.append(el('span', 'empty', 'Küme yok'));

  search.oninput = () => {
    const q = lower(search.value.trim());
    sets.forEach((s, i) => { buttons[i].hidden = !!q && !lower(s.name).includes(q); });
  };
  // "tümü"/"hiçbiri" only affect the sets visible under the current search
  const setVisible = (on) => {
    sets.forEach((s, i) => {
      if (buttons[i].hidden) return;
      data.prefs.selected = data.prefs.selected.filter((x) => x !== s.id);
      if (on) data.prefs.selected.push(s.id);
      buttons[i].classList.toggle('on', on);
    });
    save();
    updateSummary();
  };
  all.onclick = () => setVisible(true);
  none.onclick = () => setVisible(false);

  body.append(tools, pills);
  group.append(body);
  return group;
}

$('#shuffleAll').onchange =(e) => { data.prefs.shuffle = e.target.checked; save(); };

// All words of a type from the selected sets, each paired with its source set.
function pool(type) {
  const seen = new Set();
  const out = [];
  for (const s of setsOfType(type)) {
    if (!data.prefs.selected.includes(s.id)) continue;
    for (const w of s.words) if (!seen.has(w)) { seen.add(w); out.push({ w, s: s.id }); }
  }
  return out;
}

function generate() {
  const out = [];
  for (const { key } of TYPES) {
    shuffle(pool(key)).slice(0, data.prefs.counts[key]).forEach((p) => out.push({ t: key, ...p }));
  }
  if (!out.length) return toast('Seçili kümelerde kelime yok 🥺');
  current = data.prefs.shuffle ? shuffle(out) : out;
  renderResult();
}

const usedWords = () => new Set(current.map((c) => c.w));

function reroll(i) {
  const c = current[i];
  const src = setById(c.s);
  const used = usedWords();
  const options = (src ? src.words.map((w) => ({ w, s: src.id })) : pool(c.t)).filter((p) => !used.has(p.w));
  if (!options.length) return toast('Bu kümede başka kelime yok');
  current[i] = { t: c.t, ...pick(options) };
  renderResult();
}

function renderResult() {
  const box = $('#result');
  box.innerHTML = '';
  if (!current.length) box.append(el('span', 'empty', 'Henüz kelime yok. Fikir üret ya da aşağıdan ekle.'));
  current.forEach((c, i) => {
    const chip = el('span', 'chip pick t-' + c.t);
    chip.style.animationDelay = i * 40 + 'ms';
    chip.title = (setById(c.s)?.name || typeLabel(c.t)) + ' — değiştirmek için dokun';
    chip.append(c.w, el('small', null, setById(c.s)?.name || typeLabel(c.t)));
    chip.onclick = () => reroll(i);
    const x = el('button', 'x', '×');
    x.title = 'Çıkar';
    x.onclick = (e) => { e.stopPropagation(); current.splice(i, 1); renderResult(); };
    chip.append(x);
    box.append(chip);
  });
}

function renderAddSelect() {
  const sel = $('#addSet');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const { key, label } of TYPES) {
    const og = el('optgroup');
    og.label = label;
    for (const s of setsOfType(key)) {
      const o = el('option', null, s.name);
      o.value = s.id;
      og.append(o);
    }
    if (og.children.length) sel.append(og);
  }
  if (setById(prev)) sel.value = prev;
  renderAddWords();
}

function renderAddWords() {
  const sel = $('#addWord');
  sel.innerHTML = '';
  const s = setById($('#addSet').value);
  const rnd = el('option', null, '🎲 Rastgele');
  rnd.value = '';
  sel.append(rnd);
  for (const w of s ? [...s.words].sort((a, b) => a.localeCompare(b, 'tr')) : []) {
    const o = el('option', null, w);
    o.value = w;
    sel.append(o);
  }
}

$('#addSet').onchange = renderAddWords;

$('#addBtn').onclick = () => {
  const s = setById($('#addSet').value);
  if (!s) return toast('Önce bir küme ekle');
  const custom = $('#addCustom').value.trim();
  let w = custom || $('#addWord').value;
  if (custom) {
    $('#addCustom').value = '';
    if (!s.words.includes(custom)) {
      s.words.push(custom);
      save();
      renderAddWords();
      toast(`"${custom}" → ${s.name}`);
    }
  } else if (!w) {
    const used = usedWords();
    const options = s.words.filter((x) => !used.has(x));
    if (!options.length) return toast('Bu kümede eklenecek kelime kalmadı');
    w = pick(options);
  }
  current.push({ t: s.type, w, s: s.id });
  renderResult();
};

$('#addCustom').onkeydown = (e) => { if (e.key === 'Enter') $('#addBtn').click(); };
$('#clearBtn').onclick =() => { current = []; renderResult(); };
$('#generateBtn').onclick = generate;

$('#saveNoteBtn').onclick = () => {
  if (!current.length && !$('#noteText').value.trim()) return toast('Kaydedilecek bir şey yok');
  data.notes.unshift({
    id: uid(),
    date: new Date().toISOString(),
    words: current.map((c) => ({ t: c.t, w: c.w, s: setById(c.s)?.name || '' })),
    text: $('#noteText').value.trim(),
  });
  save();
  $('#noteText').value = '';
  toast('Not kaydedildi 💗');
};

/* ---------- Sets ---------- */
let activeType = 'noun';
let activeSetId = setsOfType(activeType)[0]?.id || null;

function renderSets() {
  const tabs = $('#typeTabs');
  tabs.innerHTML = '';
  for (const { key, label } of TYPES) {
    const b = el('button', 't-' + key + (key === activeType ? ' on' : ''), `${label} (${setsOfType(key).length})`);
    b.onclick = () => { activeType = key; activeSetId = setsOfType(key)[0]?.id || null; renderSets(); };
    tabs.append(b);
  }

  const sets = setsOfType(activeType);
  if (!sets.find((s) => s.id === activeSetId)) activeSetId = sets[0]?.id || null;
  const sel = $('#setSelect');
  sel.innerHTML = '';
  for (const s of sets) {
    const o = el('option', null, `${s.name} (${s.words.length})`);
    o.value = s.id;
    sel.append(o);
  }
  sel.value = activeSetId || '';

  const box = $('#setWords');
  box.innerHTML = '';
  const set = setById(activeSetId);
  const card = el('div', 'card');
  box.append(card);
  if (!set) {
    card.append(el('p', 'empty', `${typeLabel(activeType)} kümesi yok. ＋ ile yeni bir küme ekle.`));
    return;
  }

  const head = el('div', 'type-head');
  head.append(el('h2', null, set.name), el('span', 'badge t-' + set.type, `${set.words.length} kelime`));
  const chips = el('div', 'chips words');
  if (!set.words.length) chips.append(el('span', 'empty', 'Boş'));
  set.words.forEach((w, i) => {
    const chip = el('span', 'chip t-' + set.type, w);
    const x = el('button', 'x', '×');
    x.title = 'Sil';
    x.onclick = () => { set.words.splice(i, 1); save(); renderSets(); };
    chip.append(x);
    chips.append(chip);
  });

  const form = el('form', 'row');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Ekle (virgülle birden çok)';
  form.append(input, el('button', 'btn small', '＋'));
  form.onsubmit = (e) => {
    e.preventDefault();
    const fresh = input.value.split(',').map((s) => s.trim()).filter((w) => w && !set.words.includes(w));
    if (!fresh.length) return;
    set.words.push(...new Set(fresh));
    save();
    renderSets();
    $('#setWords input')?.focus();
  };

  card.append(head, chips, form);
}

$('#setSelect').onchange = (e) => { activeSetId = e.target.value; renderSets(); };

function createSet(type) {
  const name = prompt(`Yeni ${lower(typeLabel(type))} kümesinin adı:`)?.trim();
  if (!name) return null;
  if (setsOfType(type).some((s) => lower(s.name) === lower(name))) return toast('Bu adda küme zaten var'), null;
  const words = prompt('Kelimeler (virgülle ayır, sonra da ekleyebilirsin):') || '';
  const s = normalizeSet({ name, type, words: words.split(',') });
  data.sets.push(s);
  data.prefs.selected.push(s.id);
  save();
  toast(`"${s.name}" kümesi eklendi`);
  return s;
}

$('#addSetBtn').onclick = () => {
  const s = createSet(activeType);
  if (!s) return;
  activeSetId = s.id;
  renderSets();
};

$('#renameSetBtn').onclick = () => {
  const s = setById(activeSetId);
  if (!s) return;
  const name = prompt('Yeni ad:', s.name)?.trim();
  if (!name) return;
  s.name = name;
  save();
  renderSets();
};

$('#delSetBtn').onclick = () => {
  const s = setById(activeSetId);
  if (!s || !confirm(`"${s.name}" kümesi ve tüm kelimeleri silinsin mi?`)) return;
  data.sets = data.sets.filter((x) => x.id !== s.id);
  current = current.filter((c) => c.s !== s.id);
  save();
  renderSets();
};

/* ---------- Notes ---------- */
function renderNotes() {
  const q = lower($('#noteSearch').value.trim());
  const list = $('#noteList');
  list.innerHTML = '';
  const notes = data.notes.filter((n) => !q || lower(n.text + ' ' + n.words.map((w) => w.w).join(' ')).includes(q));
  if (!notes.length) {
    const c = el('div', 'card');
    c.append(el('p', 'empty', data.notes.length ? 'Eşleşen not yok.' : 'Henüz not yok. Fikir üret ve kaydet ✨'));
    list.append(c);
    return;
  }
  for (const n of notes) {
    const card = el('div', 'card note');
    const chips = el('div', 'chips');
    n.words.forEach((w) => {
      const chip = el('span', 'chip t-' + w.t, w.w);
      if (w.s) chip.title = w.s;
      chips.append(chip);
    });
    card.append(chips);
    if (n.text) card.append(el('p', null, n.text));

    const foot = el('div', 'note-foot');
    foot.append(el('span', null, new Date(n.date).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })));
    const actions = el('div', 'row');
    const edit = el('button', 'btn ghost', '✎ Düzenle');
    edit.onclick = () => {
      const text = prompt('Notu düzenle:', n.text);
      if (text == null) return;
      n.text = text.trim();
      save();
      renderNotes();
    };
    const del = el('button', 'btn ghost', '🗑 Sil');
    del.onclick = () => {
      if (!confirm('Bu not silinsin mi?')) return;
      data.notes = data.notes.filter((x) => x.id !== n.id);
      save();
      renderNotes();
    };
    actions.append(edit, del);
    foot.append(actions);
    card.append(foot);
    list.append(card);
  }
}

$('#noteSearch').oninput = renderNotes;

/* ---------- Export / Import ---------- */
$('#exportBtn').onclick = () => {
  const payload = { app: 'Yumis', version: 2, exportedAt: new Date().toISOString(), sets: data.sets, notes: data.notes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yumis-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Dışa aktarıldı 📦');
};

$('#importInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.sets) && !Array.isArray(d.topics) && !Array.isArray(d.notes)) throw new Error('format');
    const sets = Array.isArray(d.sets) ? d.sets.map(normalizeSet) : topicsToSets(d.topics);
    const notes = (d.notes || []).map(normalizeNote);

    if ($('#importReplace').checked) {
      if (!confirm('Mevcut tüm veriler silinip içe aktarılanla değiştirilsin mi?')) return;
      data.sets = sets;
      data.notes = notes;
      data.prefs.selected = sets.map((s) => s.id);
      current = [];
    } else {
      const added = mergeSets(data.sets, sets);
      data.prefs.selected.push(...added.map((s) => s.id));
      const ids = new Set(data.notes.map((n) => n.id));
      data.notes.push(...notes.filter((n) => !ids.has(n.id)));
      data.notes.sort((a, b) => b.date.localeCompare(a.date));
    }
    save();
    renderAll();
    toast('İçe aktarıldı 🎀');
  } catch {
    toast('Geçersiz JSON dosyası');
  }
};

$('#defaultsBtn').onclick = () => {
  const added = mergeSets(data.sets, defaultSets());
  save();
  renderAll();
  toast(added.length ? `${added.length} küme eklendi 🧺` : 'Hazır kümeler güncellendi');
};

$('#resetBtn').onclick = () => {
  if (!confirm('Tüm kümeler, kelimeler ve notlar silinecek. Emin misin?')) return;
  data = defaultData();
  save();
  current = [];
  renderAll();
  toast('Sıfırlandı');
};

function renderAll() {
  renderGen();
  renderSets();
  renderNotes();
}

renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
