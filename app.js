/* Pocket Editor — スマホ向けテキストエディタ */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const ed = $('#editor');
  const root = document.documentElement;

  // ===================================================================
  // 設定
  // ===================================================================
  const SETTINGS_KEY = 'pocket-editor:settings';
  const LAST_FILE_KEY = 'pocket-editor:last-file';
  const DEFAULT_SETTINGS = {
    fontSize: 15,
    theme: 'auto',
    indent: '2',
    wrap: true,
    mono: true,
    autoIndent: true,
    pairs: true,
  };

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 保存できない環境では無視 */ }
  }

  let settings = { ...DEFAULT_SETTINGS };
  try { Object.assign(settings, JSON.parse(lsGet(SETTINGS_KEY) || '{}')); } catch { /* 破損時は既定値 */ }

  function saveSettings() { lsSet(SETTINGS_KEY, JSON.stringify(settings)); }

  function applySettings() {
    root.style.setProperty('--font-size', settings.fontSize + 'px');
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    ed.classList.toggle('nowrap', !settings.wrap);
    ed.classList.toggle('proportional', !settings.mono);
    ed.style.tabSize = settings.indent === 'tab' ? '4' : settings.indent;
    const dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#26282e' : '#f4f5f7');
    if (search.open) renderHighlights();
  }

  const indentUnit = () => (settings.indent === 'tab' ? '\t' : ' '.repeat(Number(settings.indent)));

  // ===================================================================
  // ストレージ（IndexedDB、使えなければ localStorage）
  // ===================================================================
  const store = (() => {
    const DB_NAME = 'pocket-editor';
    const STORE = 'files';
    const LS_KEY = 'pocket-editor:files';
    let dbPromise = null;

    function openDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    function tx(mode, fn) {
      return openDB().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const result = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        t.onerror = () => reject(t.error);
      }));
    }

    const lsAll = () => { try { return JSON.parse(lsGet(LS_KEY) || '[]'); } catch { return []; } };
    const lsWrite = (files) => lsSet(LS_KEY, JSON.stringify(files));

    return {
      all: () => tx('readonly', (s) => s.getAll()).catch(() => lsAll()),
      put: (file) => tx('readwrite', (s) => { s.put(file); }).catch(() => {
        const files = lsAll().filter((f) => f.id !== file.id);
        files.push(file);
        lsWrite(files);
      }),
      remove: (id) => tx('readwrite', (s) => { s.delete(id); }).catch(() => {
        lsWrite(lsAll().filter((f) => f.id !== id));
      }),
    };
  })();

  // ===================================================================
  // ファイル管理
  // ===================================================================
  let files = [];
  let current = null;
  let saveTimer = null;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function uniqueName(base) {
    const names = new Set(files.map((f) => f.name));
    if (!names.has(base)) return base;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; ; i++) {
      const name = `${stem} (${i})${ext}`;
      if (!names.has(name)) return name;
    }
  }

  async function createFile(name = 'untitled.txt', content = '') {
    const now = Date.now();
    const file = { id: newId(), name: uniqueName(name), content, created: now, updated: now };
    files.push(file);
    await store.put(file);
    openFile(file);
    return file;
  }

  function openFile(file) {
    flushSave();
    current = file;
    ed.value = file.content;
    ed.setSelectionRange(file.cursor || 0, file.cursor || 0);
    ed.scrollTop = file.scroll || 0;
    $('#filename').textContent = file.name;
    document.title = `${file.name} — Pocket Editor`;
    lsSet(LAST_FILE_KEY, file.id);
    setDirty(false);
    updateStatus();
    if (search.open) refreshSearch();
  }

  function setDirty(on) { $('#save-state').classList.toggle('on', on); }

  function scheduleSave() {
    setDirty(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!current) return;
    const changed = current.content !== ed.value;
    current.cursor = ed.selectionStart;
    current.scroll = ed.scrollTop;
    if (changed) {
      current.content = ed.value;
      current.updated = Date.now();
    }
    store.put(current).then(() => setDirty(false));
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!confirm(`「${current.name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    clearTimeout(saveTimer);
    const id = current.id;
    files = files.filter((f) => f.id !== id);
    current = null;
    await store.remove(id);
    const next = [...files].sort((a, b) => b.updated - a.updated)[0];
    if (next) openFile(next);
    else await createFile();
    toast('削除しました');
  }

  function renameCurrent() {
    const name = prompt('ファイル名', current.name);
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === current.name) return;
    current.name = uniqueName(trimmed);
    $('#filename').textContent = current.name;
    document.title = `${current.name} — Pocket Editor`;
    flushSave();
    store.put(current);
  }

  // ===================================================================
  // 編集操作（execCommand を使ってネイティブの undo 履歴を保つ）
  // ===================================================================
  function insertText(text) {
    ed.focus({ preventScroll: true });
    let ok = false;
    try {
      ok = text === ''
        ? (ed.selectionStart === ed.selectionEnd || document.execCommand('delete'))
        : document.execCommand('insertText', false, text);
    } catch { ok = false; }
    if (!ok) {
      ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, 'end');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function replaceRange(start, end, text) {
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(start, end);
    insertText(text);
  }

  function lineBounds(pos, v = ed.value) {
    const start = v.lastIndexOf('\n', pos - 1) + 1;
    let end = v.indexOf('\n', pos);
    if (end < 0) end = v.length;
    return { start, end };
  }

  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

  function typeChar(ch) {
    const s = ed.selectionStart;
    const e = ed.selectionEnd;
    const v = ed.value;
    if (settings.pairs && PAIRS[ch]) {
      const close = PAIRS[ch];
      if (s !== e) {
        // 選択範囲を括弧で囲む
        const inner = v.slice(s, e);
        insertText(ch + inner + close);
        ed.setSelectionRange(s + 1, s + 1 + inner.length);
        return;
      }
      if (ch === close && v[s] === close) {
        // 閉じ引用符の上なら移動するだけ
        ed.focus({ preventScroll: true });
        ed.setSelectionRange(s + 1, s + 1);
        return;
      }
      insertText(ch + close);
      ed.setSelectionRange(s + 1, s + 1);
      return;
    }
    if (settings.pairs && ')]}'.includes(ch) && s === e && v[s] === ch) {
      ed.focus({ preventScroll: true });
      ed.setSelectionRange(s + 1, s + 1);
      return;
    }
    insertText(ch);
  }

  function indentLines(outdent) {
    const v = ed.value;
    const s = ed.selectionStart;
    const e = ed.selectionEnd;
    if (!outdent && s === e) { insertText(indentUnit()); return; }

    const ls = lineBounds(s, v).start;
    const endPos = e > s && v[e - 1] === '\n' ? e - 1 : e;
    const le = lineBounds(endPos, v).end;
    const lines = v.slice(ls, le).split('\n');
    const unit = indentUnit();
    const width = settings.indent === 'tab' ? 4 : Number(settings.indent);

    const out = lines.map((line) => {
      if (!outdent) return line.length ? unit + line : line;
      if (line.startsWith('\t')) return line.slice(1);
      const m = line.match(/^ +/);
      return m ? line.slice(Math.min(m[0].length, width)) : line;
    });
    const block = out.join('\n');
    if (block === lines.join('\n')) return;

    replaceRange(ls, le, block);
    if (s === e) {
      const pos = Math.max(ls, s + (out[0].length - lines[0].length));
      ed.setSelectionRange(pos, pos);
    } else {
      ed.setSelectionRange(ls, ls + block.length);
    }
  }

  function moveCaret(pos, extend = false) {
    ed.focus({ preventScroll: true });
    pos = Math.max(0, Math.min(ed.value.length, pos));
    if (extend) ed.setSelectionRange(Math.min(ed.selectionStart, pos), Math.max(ed.selectionEnd, pos));
    else ed.setSelectionRange(pos, pos);
    revealCaret();
  }

  let goalColumn = null;
  function moveVertical(dir) {
    const v = ed.value;
    const p = dir < 0 ? ed.selectionStart : ed.selectionEnd;
    const cur = lineBounds(p, v);
    const col = goalColumn ?? (p - cur.start);
    let target;
    if (dir < 0) {
      if (cur.start === 0) target = 0;
      else {
        const prev = lineBounds(cur.start - 1, v);
        target = prev.start + Math.min(col, prev.end - prev.start);
      }
    } else if (cur.end === v.length) {
      target = v.length;
    } else {
      const next = lineBounds(cur.end + 1, v);
      target = next.start + Math.min(col, next.end - next.start);
    }
    moveCaret(target);
    goalColumn = col;
  }

  function selectLine() {
    const { start, end } = lineBounds(ed.selectionStart);
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(start, Math.min(end + 1, ed.value.length));
  }

  function duplicateLine() {
    const v = ed.value;
    const s = ed.selectionStart;
    const { start, end } = lineBounds(s, v);
    const line = v.slice(start, end);
    replaceRange(end, end, '\n' + line);
    const pos = s + line.length + 1;
    ed.setSelectionRange(pos, pos);
  }

  function deleteLine() {
    const v = ed.value;
    let { start, end } = lineBounds(ed.selectionStart, v);
    if (end < v.length) end += 1;
    else if (start > 0) start -= 1;
    replaceRange(start, end, '');
  }

  function execHistory(cmd) {
    ed.focus({ preventScroll: true });
    try { document.execCommand(cmd); } catch { /* 未対応ブラウザ */ }
  }

  // ===================================================================
  // キャレットを画面内に表示する（ミラー要素で位置を計測）
  // ===================================================================
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden',
  });
  document.body.appendChild(mirror);

  const MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
    'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingTop', 'paddingLeft', 'paddingRight',
    'borderLeftWidth', 'borderRightWidth', 'boxSizing',
  ];

  function caretCoords(pos) {
    const cs = getComputedStyle(ed);
    for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
    mirror.style.width = ed.clientWidth + 'px';
    mirror.textContent = ed.value.slice(0, pos);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    return { top: marker.offsetTop, left: marker.offsetLeft, lineHeight: parseFloat(cs.lineHeight) || 20 };
  }

  function revealCaret(pos = ed.selectionEnd) {
    const { top, left, lineHeight } = caretCoords(pos);
    if (top < ed.scrollTop) ed.scrollTop = Math.max(0, top - lineHeight);
    else if (top + lineHeight > ed.scrollTop + ed.clientHeight) {
      ed.scrollTop = top - ed.clientHeight + lineHeight * 2;
    }
    if (!settings.wrap) {
      if (left < ed.scrollLeft) ed.scrollLeft = Math.max(0, left - 40);
      else if (left > ed.scrollLeft + ed.clientWidth - 20) ed.scrollLeft = left - ed.clientWidth + 60;
    }
  }

  // ===================================================================
  // 補助キーバー
  // ===================================================================
  const KEYS = [
    { label: 'Tab', act: () => indentLines(false), wide: true },
    { label: '⇤', act: () => indentLines(true), title: 'インデント解除' },
    { label: '←', act: () => moveCaret(ed.selectionStart === ed.selectionEnd ? ed.selectionStart - 1 : ed.selectionStart), repeat: true },
    { label: '↑', act: () => moveVertical(-1), repeat: true, keepGoal: true },
    { label: '↓', act: () => moveVertical(1), repeat: true, keepGoal: true },
    { label: '→', act: () => moveCaret(ed.selectionStart === ed.selectionEnd ? ed.selectionEnd + 1 : ed.selectionEnd), repeat: true },
    { label: '行頭', act: () => moveCaret(lineBounds(ed.selectionStart).start), wide: true },
    { label: '行末', act: () => moveCaret(lineBounds(ed.selectionEnd).end), wide: true },
    ...'(){}[]<>"\'`;:=+-*/\\|&!?#$%_~^@,.'.split('').map((ch) => ({ label: ch, act: () => typeChar(ch) })),
    { label: '行選択', act: selectLine, wide: true },
    { label: '行複製', act: duplicateLine, wide: true },
    { label: '行削除', act: deleteLine, wide: true },
  ];

  function buildKeybar() {
    const bar = $('#keybar');
    for (const key of KEYS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key' + (key.wide ? ' wide' : '');
      btn.textContent = key.label;
      btn.tabIndex = -1;
      if (key.title) btn.title = key.title;
      btn.setAttribute('aria-label', key.title || key.label);

      let holdTimer = null;
      let repeatTimer = null;
      let repeated = false;
      const stop = () => {
        clearTimeout(holdTimer);
        clearInterval(repeatTimer);
        holdTimer = repeatTimer = null;
        btn.classList.remove('pressed');
      };

      const run = () => {
        if (!key.keepGoal) goalColumn = null;
        key.act();
      };

      if (key.repeat) {
        btn.addEventListener('pointerdown', () => {
          repeated = false;
          holdTimer = setTimeout(() => {
            repeated = true;
            btn.classList.add('pressed');
            run();
            repeatTimer = setInterval(run, 55);
          }, 380);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
      }
      btn.addEventListener('click', () => {
        if (repeated) { repeated = false; return; }
        run();
      });
      bar.appendChild(btn);
    }
  }

  // ボタンを押してもエディタのフォーカス（＝キーボード）を奪わない
  function keepFocus(el) {
    el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  // ===================================================================
  // 自動インデント
  // ===================================================================
  ed.addEventListener('beforeinput', (e) => {
    if (!settings.autoIndent || e.isComposing) return;
    if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
    const v = ed.value;
    const s = ed.selectionStart;
    const before = v.slice(lineBounds(s, v).start, s);
    const indent = before.match(/^[ \t]*/)[0];
    const last = before.trimEnd().slice(-1);
    const opens = last && '{[('.includes(last);
    if (!indent && !opens) return;

    e.preventDefault();
    const extra = opens ? indentUnit() : '';
    const closer = { '{': '}', '[': ']', '(': ')' }[last];
    const nextChar = v[ed.selectionEnd];
    // beforeinput の処理中に編集コマンドを呼ばないよう、マイクロタスクに回す
    Promise.resolve().then(() => {
      if (opens && nextChar === closer) {
        const start = ed.selectionStart;
        insertText('\n' + indent + extra + '\n' + indent);
        const pos = start + 1 + indent.length + extra.length;
        ed.setSelectionRange(pos, pos);
      } else {
        insertText('\n' + indent + extra);
      }
      revealCaret();
    });
  });

  // ハードウェアキーボード用ショートカット
  ed.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      indentLines(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushSave();
      toast('保存しました');
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateLine();
    }
  });

  // ===================================================================
  // ステータスバー
  // ===================================================================
  function updateStatus() {
    const v = ed.value;
    const p = ed.selectionEnd;
    const before = v.slice(0, p);
    const line = before.split('\n').length;
    const col = p - (before.lastIndexOf('\n') + 1) + 1;
    const sel = Math.abs(ed.selectionEnd - ed.selectionStart);
    $('#status-pos').textContent = `${line}行 : ${col}列` + (sel ? `（${sel}文字選択）` : '');
    const lines = v ? v.split('\n').length : 1;
    $('#status-info').textContent = `${lines}行 / ${[...v].length}文字`;
  }

  let statusRaf = 0;
  const queueStatus = () => {
    cancelAnimationFrame(statusRaf);
    statusRaf = requestAnimationFrame(updateStatus);
  };

  ed.addEventListener('input', () => {
    scheduleSave();
    queueStatus();
    if (search.open) queueSearchRefresh();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === ed) queueStatus();
  });
  ed.addEventListener('pointerdown', () => { goalColumn = null; });

  // ===================================================================
  // 検索・置換
  // ===================================================================
  const search = { open: false, matches: [], index: -1 };
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  highlight.setAttribute('aria-hidden', 'true');
  ed.before(highlight);

  function buildRegex() {
    const q = $('#find-input').value;
    if (!q) return null;
    const flags = 'g' + ($('#opt-case').checked ? '' : 'i') + 'u';
    try {
      const src = $('#opt-regex').checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(src, flags);
    } catch {
      return 'invalid';
    }
  }

  function findAll() {
    const re = buildRegex();
    search.matches = [];
    if (!re) return '';
    if (re === 'invalid') return '正規表現エラー';
    const v = ed.value;
    let m;
    while ((m = re.exec(v)) && search.matches.length < 20000) {
      if (m[0] === '') { re.lastIndex++; continue; }
      search.matches.push({ start: m.index, end: m.index + m[0].length });
    }
    return null;
  }

  function refreshSearch() {
    const err = findAll();
    const { matches } = search;
    // 現在の選択に一致するものがあればそれを現在位置にする
    const s = ed.selectionStart;
    search.index = matches.findIndex((m) => m.start >= s);
    if (search.index > 0 && matches[search.index].start !== s) {
      const prevIdx = search.index - 1;
      if (matches[prevIdx].end > s) search.index = prevIdx;
    }
    updateCount(err);
    renderHighlights();
  }

  let searchTimer = 0;
  function queueSearchRefresh() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshSearch, 150);
  }

  function updateCount(err) {
    const el = $('#match-count');
    if (err) { el.textContent = err; return; }
    const n = search.matches.length;
    if (!$('#find-input').value) el.textContent = '';
    else if (!n) el.textContent = '0件';
    else el.textContent = search.index >= 0 && isCurrentSelected() ? `${search.index + 1}/${n}` : `${n}件`;
  }

  function isCurrentSelected() {
    const m = search.matches[search.index];
    return m && ed.selectionStart === m.start && ed.selectionEnd === m.end;
  }

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function renderHighlights() {
    const active = search.open && search.matches.length > 0;
    ed.classList.toggle('searching', active);
    if (!active) { highlight.innerHTML = ''; return; }
    const v = ed.value;
    const cur = isCurrentSelected() ? search.index : -1;
    let html = '';
    let last = 0;
    search.matches.forEach((m, i) => {
      html += escapeHtml(v.slice(last, m.start));
      html += `<mark${i === cur ? ' class="current"' : ''}>${escapeHtml(v.slice(m.start, m.end))}</mark>`;
      last = m.end;
    });
    html += escapeHtml(v.slice(last)) + ' ';
    highlight.innerHTML = html;
    highlight.classList.toggle('nowrap', !settings.wrap);
    highlight.classList.toggle('proportional', !settings.mono);
    highlight.style.width = ed.clientWidth + 'px';
    highlight.style.tabSize = ed.style.tabSize;
    syncHighlightScroll();
  }

  function syncHighlightScroll() {
    highlight.scrollTop = ed.scrollTop;
    highlight.scrollLeft = ed.scrollLeft;
  }
  ed.addEventListener('scroll', () => { if (search.open) syncHighlightScroll(); }, { passive: true });

  function gotoMatch(dir) {
    if (!search.matches.length) refreshSearch();
    const { matches } = search;
    if (!matches.length) { updateCount(); return; }
    let i;
    if (isCurrentSelected()) {
      i = (search.index + dir + matches.length) % matches.length;
    } else if (dir > 0) {
      i = matches.findIndex((m) => m.start >= ed.selectionEnd);
      if (i < 0) i = 0;
    } else {
      i = -1;
      for (let k = matches.length - 1; k >= 0; k--) {
        if (matches[k].end <= ed.selectionStart) { i = k; break; }
      }
      if (i < 0) i = matches.length - 1;
    }
    search.index = i;
    const m = matches[i];
    ed.setSelectionRange(m.start, m.end);
    revealCaret(m.start);
    updateCount();
    renderHighlights();
    updateStatus();
  }

  function replacementFor(m) {
    const repl = $('#replace-input').value;
    if (!$('#opt-regex').checked) return repl;
    const re = buildRegex();
    const single = new RegExp(re.source, re.flags.replace('g', ''));
    return ed.value.slice(m.start, m.end).replace(single, repl);
  }

  function withRestoredFocus(fn) {
    const prev = document.activeElement;
    fn();
    if (prev && prev !== ed && prev !== document.body) prev.focus({ preventScroll: true });
  }

  function replaceOne() {
    if (!isCurrentSelected()) { gotoMatch(1); return; }
    const m = search.matches[search.index];
    const text = replacementFor(m);
    withRestoredFocus(() => replaceRange(m.start, m.end, text));
    const caret = m.start + text.length;
    ed.setSelectionRange(caret, caret);
    refreshSearch();
    gotoMatch(1);
  }

  function replaceAll() {
    const re = buildRegex();
    if (!re || re === 'invalid') return;
    findAll();
    const count = search.matches.length;
    if (!count) { toast('一致する箇所がありません'); return; }
    const repl = $('#replace-input').value;
    const v = ed.value;
    const next = $('#opt-regex').checked
      ? v.replace(re, repl)
      : v.replace(re, () => repl);
    const scroll = ed.scrollTop;
    withRestoredFocus(() => replaceRange(0, v.length, next));
    ed.setSelectionRange(0, 0);
    ed.scrollTop = scroll;
    refreshSearch();
    toast(`${count}件を置換しました`);
  }

  function openSearch() {
    search.open = true;
    $('#searchbar').hidden = false;
    const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    if (sel && !sel.includes('\n') && sel.length < 200) $('#find-input').value = sel;
    const input = $('#find-input');
    input.focus();
    input.select();
    refreshSearch();
  }

  function closeSearch() {
    search.open = false;
    $('#searchbar').hidden = true;
    renderHighlights();
    ed.focus({ preventScroll: true });
  }

  // ===================================================================
  // UI: ドロワー / メニュー / 設定
  // ===================================================================
  function relativeTime(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'たった今';
    if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
    return new Date(ts).toLocaleDateString('ja-JP');
  }

  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderFileList() {
    flushSave();
    const list = $('#file-list');
    list.innerHTML = '';
    const sorted = [...files].sort((a, b) => b.updated - a.updated);
    for (const f of sorted) {
      const li = document.createElement('li');
      if (current && f.id === current.id) li.classList.add('active');
      const btn = document.createElement('button');
      btn.className = 'open-file';
      btn.innerHTML = `<span class="name">${escapeHtml(f.name)}</span>` +
        `<span class="meta">${relativeTime(f.updated)} · ${formatSize(new Blob([f.content]).size)}</span>`;
      btn.addEventListener('click', () => { openFile(f); closeDrawer(); });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function openDrawer() {
    renderFileList();
    ed.blur();
    $('#drawer').hidden = false;
    $('#drawer-overlay').hidden = false;
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#drawer-overlay').hidden = true;
  }

  function openMenu() {
    $('#menu').hidden = false;
    $('#menu-overlay').hidden = false;
  }
  function closeMenu() {
    $('#menu').hidden = true;
    $('#menu-overlay').hidden = true;
  }

  function download() {
    flushSave();
    const blob = new Blob([ed.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = current.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function share() {
    flushSave();
    try {
      const file = new File([ed.value], current.name, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: current.name });
      } else if (navigator.share) {
        await navigator.share({ title: current.name, text: ed.value });
      } else {
        download();
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('共有できませんでした');
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(ed.value);
      toast('コピーしました');
    } catch {
      ed.focus();
      ed.select();
      toast('全選択しました。コピーしてください');
    }
  }

  function gotoLine() {
    const total = ed.value.split('\n').length;
    const input = prompt(`移動する行番号（1〜${total}）`);
    if (input == null) return;
    const n = Math.max(1, Math.min(total, parseInt(input, 10) || 1));
    let pos = 0;
    for (let i = 1; i < n; i++) pos = ed.value.indexOf('\n', pos) + 1;
    moveCaret(pos);
  }

  function openFromDevice() {
    const input = $('#file-input');
    input.value = '';
    input.click();
  }

  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('ファイルが大きすぎます（20MBまで）'); return; }
    const text = await file.text();
    await createFile(file.name, text);
    toast(`「${file.name}」を開きました`);
  });

  function openSettings() {
    $('#set-font-size').value = settings.fontSize;
    $('#font-size-out').textContent = settings.fontSize;
    $('#set-theme').value = settings.theme;
    $('#set-indent').value = settings.indent;
    $('#set-wrap').checked = settings.wrap;
    $('#set-mono').checked = settings.mono;
    $('#set-autoindent').checked = settings.autoIndent;
    $('#set-pairs').checked = settings.pairs;
    $('#settings').showModal();
  }

  function bindSetting(id, key, read) {
    $(id).addEventListener('input', (e) => {
      settings[key] = read(e.target);
      if (key === 'fontSize') $('#font-size-out').textContent = settings.fontSize;
      applySettings();
      saveSettings();
    });
  }
  bindSetting('#set-font-size', 'fontSize', (el) => Number(el.value));
  bindSetting('#set-theme', 'theme', (el) => el.value);
  bindSetting('#set-indent', 'indent', (el) => el.value);
  bindSetting('#set-wrap', 'wrap', (el) => el.checked);
  bindSetting('#set-mono', 'mono', (el) => el.checked);
  bindSetting('#set-autoindent', 'autoIndent', (el) => el.checked);
  bindSetting('#set-pairs', 'pairs', (el) => el.checked);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  // ===================================================================
  // イベント登録
  // ===================================================================
  $('#btn-files').addEventListener('click', openDrawer);
  $('#drawer-overlay').addEventListener('click', closeDrawer);
  $('#btn-new').addEventListener('click', async () => { closeDrawer(); await createFile(); ed.focus(); });
  $('#btn-rename').addEventListener('click', renameCurrent);
  $('#btn-menu').addEventListener('click', openMenu);
  $('#menu-overlay').addEventListener('click', closeMenu);
  $('#btn-search').addEventListener('click', () => (search.open ? closeSearch() : openSearch()));
  $('#btn-undo').addEventListener('click', () => execHistory('undo'));
  $('#btn-redo').addEventListener('click', () => execHistory('redo'));
  ['#btn-undo', '#btn-redo', '#find-prev', '#find-next', '#replace-one', '#replace-all'].forEach((s) => keepFocus($(s)));
  keepFocus($('#keybar'));

  if (!navigator.share) $('#menu-share').textContent = '共有（ダウンロード）';

  $('#menu').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    closeMenu();
    ({
      new: async () => { await createFile(); ed.focus(); },
      open: openFromDevice,
      download,
      share,
      copy: copyAll,
      goto: gotoLine,
      settings: openSettings,
      delete: deleteCurrent,
    })[action]();
  });

  $('#find-input').addEventListener('input', queueSearchRefresh);
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeSearch();
  });
  $('#replace-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    if (e.key === 'Escape') closeSearch();
  });
  $('#opt-case').addEventListener('change', refreshSearch);
  $('#opt-regex').addEventListener('change', refreshSearch);
  $('#find-next').addEventListener('click', () => gotoMatch(1));
  $('#find-prev').addEventListener('click', () => gotoMatch(-1));
  $('#replace-one').addEventListener('click', replaceOne);
  $('#replace-all').addEventListener('click', replaceAll);
  $('#search-close').addEventListener('click', closeSearch);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#menu').hidden) closeMenu();
    else if (!$('#drawer').hidden) closeDrawer();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);

  // ===================================================================
  // ソフトウェアキーボード対応（表示領域に合わせてレイアウトを縮める）
  // ===================================================================
  const vv = window.visualViewport;
  let fullHeight = 0;
  let lastWidth = 0;
  function onViewport() {
    if (!vv) return;
    if (vv.width !== lastWidth) { fullHeight = 0; lastWidth = vv.width; }
    fullHeight = Math.max(fullHeight, vv.height);
    root.style.setProperty('--app-height', vv.height + 'px');
    root.style.setProperty('--app-top', vv.offsetTop + 'px');
    document.body.classList.toggle('keyboard-open', fullHeight - vv.height > 120);
    if (search.open) renderHighlights();
  }
  if (vv) {
    vv.addEventListener('resize', onViewport);
    vv.addEventListener('scroll', onViewport);
    onViewport();
  }
  // iOS でフォーカス時にページ自体がスクロールしてしまうのを戻す
  window.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });

  // ===================================================================
  // 起動
  // ===================================================================
  const WELCOME = `Pocket Editor へようこそ！

スマホで快適に使えるテキストエディタです。
入力内容は端末内（ブラウザ）に自動保存されます。

■ 基本操作
・左上の ☰ … ファイル一覧／新規作成
・ファイル名をタップ … 名前を変更
・↶ ↷ … 元に戻す／やり直す
・🔍 … 検索と置換（正規表現対応）
・︙ … 開く・ダウンロード・共有・設定など

■ 補助キー（キーボードの上）
・Tab ⇤ … インデント／インデント解除（複数行選択にも対応）
・← ↑ ↓ → … カーソル移動（長押しで連続移動）
・記号キー … 括弧や引用符は自動で閉じます
・行選択／行複製／行削除

■ ホーム画面に追加
ブラウザの「共有」→「ホーム画面に追加」で
アプリのように全画面で使えます（オフラインでも動作）。

このファイルは自由に編集・削除してかまいません。
`;

  async function init() {
    applySettings();
    buildKeybar();
    files = await store.all();
    if (!files.length) {
      await createFile('はじめに.txt', WELCOME);
      return;
    }
    const lastId = lsGet(LAST_FILE_KEY);
    const file = files.find((f) => f.id === lastId) ||
      [...files].sort((a, b) => b.updated - a.updated)[0];
    openFile(file);
  }

  init();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン非対応でも動作は継続 */ });
    });
  }
})();
