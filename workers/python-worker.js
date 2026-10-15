/* Python 実行用 Worker（Pyodide） */
/* global loadPyodide */
let pyodide = null;
let runner = null;

const SETUP = `
import sys, io, traceback

try:
    sys.set_int_max_str_digits(0)  # Project Euler の巨大整数を str() できるように
except AttributeError:
    pass

def __run_user_code(src, stdin_data):
    sys.stdin = io.TextIOWrapper(io.BytesIO(stdin_data.encode()), encoding="utf-8")
    g = {"__name__": "__main__", "__builtins__": __builtins__}
    code = 0
    try:
        exec(compile(src, "main.py", "exec"), g)
    except SystemExit as e:
        if e.code is None:
            code = 0
        elif isinstance(e.code, int):
            code = e.code
        else:
            print(e.code, file=sys.stderr)
            code = 1
    except BaseException as e:
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        traceback.print_exception(type(e), e, tb)
        code = 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    return code
`;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      importScripts(msg.indexURL + 'pyodide.js');
      pyodide = await loadPyodide({ indexURL: msg.indexURL });
      pyodide.runPython(SETUP);
      runner = pyodide.globals.get('__run_user_code');
      postMessage({ type: 'ready', version: pyodide.version });
    } catch (err) {
      postMessage({ type: 'init-error', message: String(err && err.message || err) });
    }
  } else if (msg.type === 'run') {
    run(msg);
  }
};

async function run({ id, code, input }) {
  const buf = { stdout: '', stderr: '' };
  let last = performance.now();
  const flush = () => {
    for (const stream of ['stdout', 'stderr']) {
      if (buf[stream]) {
        postMessage({ type: 'out', id, stream, data: buf[stream] });
        buf[stream] = '';
      }
    }
    last = performance.now();
  };
  const writer = (stream) => (line) => {
    buf[stream] += line + '\n';
    if (buf[stream].length > 16384 || performance.now() - last > 150) flush();
  };
  pyodide.setStdout({ batched: writer('stdout') });
  pyodide.setStderr({ batched: writer('stderr') });

  // import されているパッケージ（numpy など）を自動で読み込む
  try {
    await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  } catch (err) {
    buf.stderr += `[パッケージの読み込みに失敗しました] ${err && err.message || err}\n`;
  }

  const t0 = performance.now();
  let exitCode = 1;
  try {
    exitCode = runner(code, input);
  } catch (err) {
    buf.stderr += String(err && err.message || err) + '\n';
  }
  const time = performance.now() - t0;
  flush();
  postMessage({ type: 'done', id, exitCode, time });
}
