/* コード実行エンジン：Python（Pyodide）・JavaScript はブラウザ内、C++ は Wandbox API */
window.Runner = (() => {
  'use strict';

  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/';
  const WANDBOX = 'https://wandbox.org/api';

  const LANGS = {
    python: { label: 'Python', exts: ['py'] },
    cpp: { label: 'C++（オンライン）', exts: ['cpp', 'cc', 'cxx', 'hpp', 'h'] },
    javascript: { label: 'JavaScript', exts: ['js', 'mjs', 'cjs'] },
  };

  function langFromName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    for (const [id, def] of Object.entries(LANGS)) if (def.exts.includes(ext)) return id;
    return 'text';
  }

  // ---------------- Python ----------------
  let py = null; // { worker, ready: Promise }
  let runSeq = 0;

  function pythonWorker(onStatus) {
    if (py) return py;
    const worker = new Worker('workers/python-worker.js');
    const ready = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.type === 'ready') { worker.removeEventListener('message', onMsg); resolve(e.data.version); }
        if (e.data.type === 'init-error') { worker.removeEventListener('message', onMsg); reject(new Error(e.data.message)); }
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', (e) => reject(new Error(e.message || 'Worker error')));
    });
    onStatus && onStatus('Python を準備しています…（初回はダウンロードに時間がかかります）');
    worker.postMessage({ type: 'init', indexURL: PYODIDE_URL });
    py = { worker, ready };
    ready.catch(() => { if (py && py.worker === worker) { worker.terminate(); py = null; } });
    return py;
  }

  async function runPython(code, input, { onOutput, onStatus }) {
    const p = pythonWorker(onStatus);
    let stoppedWhileLoading = false;
    current = {
      stop: () => {
        stoppedWhileLoading = true;
        p.worker.terminate();
        if (py === p) py = null;
      },
    };
    try {
      await Promise.race([
        p.ready,
        new Promise((resolve) => { const t = setInterval(() => { if (stoppedWhileLoading) { clearInterval(t); resolve(); } }, 100); p.ready.finally(() => clearInterval(t)).catch(() => {}); }),
      ]);
    } catch (err) {
      current = null;
      onStatus && onStatus('');
      return { status: 'error', message: `Python を読み込めませんでした（ネット接続を確認してください）\n${err.message}` };
    }
    onStatus && onStatus('');
    if (stoppedWhileLoading) { current = null; return { status: 'stopped' }; }
    const id = ++runSeq;
    return new Promise((resolve) => {
      const onMsg = (e) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === 'out') onOutput(m.stream, m.data);
        if (m.type === 'done') {
          p.worker.removeEventListener('message', onMsg);
          current = null;
          resolve({ status: 'done', exitCode: m.exitCode, time: m.time });
        }
      };
      p.worker.addEventListener('message', onMsg);
      current = {
        stop: () => {
          p.worker.removeEventListener('message', onMsg);
          p.worker.terminate();
          py = null; // 次回は作り直す
          resolve({ status: 'stopped' });
        },
      };
      p.worker.postMessage({ type: 'run', id, code, input });
    });
  }

  // ---------------- JavaScript ----------------
  function runJs(code, input, { onOutput }) {
    return new Promise((resolve) => {
      const worker = new Worker('workers/js-worker.js');
      const finish = (result) => { worker.terminate(); current = null; resolve(result); };
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'out') onOutput(m.stream, m.data);
        if (m.type === 'done') finish({ status: 'done', exitCode: m.exitCode, time: m.time });
      };
      worker.onerror = (e) => {
        e.preventDefault();
        onOutput('stderr', (e.message || 'エラー') + '\n');
        finish({ status: 'done', exitCode: 1, time: 0 });
      };
      current = { stop: () => finish({ status: 'stopped' }) };
      worker.postMessage({ code, input });
    });
  }

  // ---------------- C++ (Wandbox) ----------------
  const COMPILER_KEY = 'pocket-editor:wandbox-compiler';
  let compilerPromise = null;

  function pickCompiler() {
    if (compilerPromise) return compilerPromise;
    compilerPromise = fetch(`${WANDBOX}/list.json`)
      .then((r) => r.json())
      .then((list) => {
        const gcc = list
          .filter((c) => c.language === 'C++' && /^gcc-\d+(\.\d+)*$/.test(c.name))
          .map((c) => ({ name: c.name, v: c.name.slice(4).split('.').map(Number) }))
          .sort((a, b) => {
            for (let i = 0; i < 3; i++) if ((b.v[i] || 0) !== (a.v[i] || 0)) return (b.v[i] || 0) - (a.v[i] || 0);
            return 0;
          });
        const name = gcc.length ? gcc[0].name : 'gcc-head';
        try { localStorage.setItem(COMPILER_KEY, name); } catch { /* 無視 */ }
        return name;
      })
      .catch(() => {
        compilerPromise = null;
        try { return localStorage.getItem(COMPILER_KEY) || 'gcc-head'; } catch { return 'gcc-head'; }
      });
    return compilerPromise;
  }

  async function runCpp(code, input, { onOutput, onStatus }) {
    const controller = new AbortController();
    let stopped = false;
    current = { stop: () => { stopped = true; controller.abort(); } };
    try {
      onStatus && onStatus('Wandbox でコンパイル・実行しています…');
      const compiler = await pickCompiler();
      const t0 = performance.now();
      const res = await fetch(`${WANDBOX}/compile.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler,
          code,
          stdin: input,
          'compiler-option-raw': '-O2\n-std=gnu++20\n-Wall',
          save: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const time = performance.now() - t0;
      onStatus && onStatus('');
      const compileOut = (j.compiler_error || '') + (j.compiler_output || '');
      const ran = 'program_output' in j || 'program_error' in j;
      if (!ran && /\berror\b/.test(j.compiler_error || '')) {
        onOutput('stderr', compileOut);
        return { status: 'compile-error', time };
      }
      if (j.program_output) onOutput('stdout', j.program_output);
      if (compileOut) onOutput('stderr', compileOut);
      if (j.program_error) onOutput('stderr', j.program_error);
      if (j.signal) onOutput('stderr', `[シグナル] ${j.signal}\n`);
      return { status: 'done', exitCode: Number(j.status || 0) || (j.signal ? 1 : 0), time, remote: true, compiler };
    } catch (err) {
      onStatus && onStatus('');
      if (stopped) return { status: 'stopped' };
      return { status: 'error', message: `Wandbox に接続できませんでした（C++ の実行にはネット接続が必要です）\n${err.message}` };
    } finally {
      current = null;
    }
  }

  // ---------------- 共通 ----------------
  let current = null;

  function run(lang, code, input, opts) {
    if (lang === 'python') return runPython(code, input, opts);
    if (lang === 'javascript') return runJs(code, input, opts);
    if (lang === 'cpp') return runCpp(code, input, opts);
    return Promise.resolve({ status: 'error', message: 'この言語は実行できません。上の選択欄で言語を選んでください。' });
  }

  function stop() { if (current) current.stop(); }

  /** Python を先に読み込んでおく（実行画面を開いたとき用） */
  function warmup(lang, onStatus) {
    if (lang === 'python') pythonWorker(onStatus).ready.then(() => onStatus && onStatus(''), () => {});
  }

  /** 出力の比較。末尾の空白・改行は無視し、小数は誤差 1e-6 まで許容 */
  function judge(actual, expected) {
    if (expected == null || expected.trim() === '') return null;
    const norm = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').trimEnd();
    if (norm(actual) === norm(expected)) return 'AC';
    const a = actual.trim().split(/\s+/);
    const b = expected.trim().split(/\s+/);
    if (a.length !== b.length) return 'WA';
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const x = Number(a[i]);
      const y = Number(b[i]);
      if (/[.eE]/.test(b[i]) && Number.isFinite(x) && Number.isFinite(y)) {
        const d = Math.abs(x - y);
        if (d <= 1e-6 || d <= 1e-6 * Math.abs(y)) continue;
      }
      return 'WA';
    }
    return 'AC';
  }

  return { LANGS, langFromName, run, stop, warmup, judge, PYODIDE_URL };
})();
