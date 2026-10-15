/* JavaScript 実行用 Worker（Node.js 風の fs / readline / process を最低限まねる） */
self.onmessage = (e) => {
  const { code, input } = e.data;
  const buf = { stdout: '', stderr: '' };
  let last = performance.now();
  const flush = () => {
    for (const stream of ['stdout', 'stderr']) {
      if (buf[stream]) {
        postMessage({ type: 'out', stream, data: buf[stream] });
        buf[stream] = '';
      }
    }
    last = performance.now();
  };
  const write = (stream, text) => {
    buf[stream] += text;
    if (buf[stream].length > 16384 || performance.now() - last > 150) flush();
  };
  const fmt = (v) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'bigint') return v + 'n';
    if (v instanceof Error) return v.stack || String(v);
    if (typeof v === 'object' && v !== null) {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  };
  const log = (stream) => (...args) => write(stream, args.map(fmt).join(' ') + '\n');

  const fakeConsole = {
    log: log('stdout'), info: log('stdout'), debug: log('stdout'),
    error: log('stderr'), warn: log('stderr'),
  };

  class Exit { constructor(code) { this.code = code; } }

  const readlines = [];
  const modules = {
    fs: { readFileSync: () => input },
    readline: {
      createInterface: () => {
        const handlers = { line: [], close: [] };
        readlines.push(handlers);
        const rl = {
          on(ev, cb) { (handlers[ev] || (handlers[ev] = [])).push(cb); return rl; },
          close() {},
        };
        return rl;
      },
    },
  };
  const fakeRequire = (name) => {
    const mod = modules[String(name).replace(/^node:/, '')];
    if (!mod) throw new Error(`require('${name}') はこの環境では使えません`);
    return mod;
  };
  const fakeProcess = {
    stdin: { fd: 0 },
    stdout: { write: (s) => { write('stdout', String(s)); return true; } },
    stderr: { write: (s) => { write('stderr', String(s)); return true; } },
    exit: (code = 0) => { throw new Exit(code); },
    argv: ['node', 'main.js'],
    env: {},
  };

  const t0 = performance.now();
  let exitCode = 0;
  try {
    new Function('console', 'require', 'process', code)(fakeConsole, fakeRequire, fakeProcess);
    const lines = input.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const h of readlines) {
      for (const line of lines) h.line.forEach((cb) => cb(line));
      h.close.forEach((cb) => cb());
    }
  } catch (err) {
    if (err instanceof Exit) exitCode = err.code;
    else { write('stderr', fmt(err) + '\n'); exitCode = 1; }
  }
  const time = performance.now() - t0;
  flush();
  postMessage({ type: 'done', exitCode, time });
};
