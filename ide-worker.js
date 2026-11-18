// Skull Dev Ops IDE: runs Python (Pyodide) off the main thread.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
let py, canInput = false, seq = 0;
const dec = new TextDecoder();
const send = (type, data) => postMessage(Object.assign({ type }, data || {}));

function syncGet(url) {
  const x = new XMLHttpRequest();
  x.open("GET", url, false);
  x.send(null);
  if (x.status !== 200) throw new Error("helper unavailable");
  return x.responseText;
}
self.readInput = () => {
  if (!canInput) return null;
  const id = Date.now() + "-" + (++seq);
  send("input-wait", { id });
  try {
    const t = syncGet("/__ide/input?id=" + encodeURIComponent(id));
    return t === "\u0000CANCEL" ? null : t;
  } catch (e) { return null; }
};
self.sleepMs = ms => {
  if (canInput) { try { syncGet("/__ide/sleep?ms=" + Math.round(ms)); return; } catch (e) {} }
  const end = Date.now() + Math.min(ms, 5000); while (Date.now() < end) {}
};

async function boot() {
  py = await loadPyodide();
  py.setStdout({ write: b => { send("out", { text: dec.decode(b) }); return b.length; } });
  py.setStderr({ write: b => { send("err", { text: dec.decode(b) }); return b.length; } });
  py.runPython(`
import builtins, time, sys, os, js
class StopProgram(Exception): pass
def _input(prompt=""):
    if prompt: sys.stdout.write(str(prompt))
    sys.stdout.flush()
    r = js.readInput()
    if r is None: raise StopProgram("\\n[Input cancelled. Program stopped.]")
    return str(r)
builtins.input = _input
time.sleep = lambda s: js.sleepMs(float(s) * 1000)
os.makedirs("/home/pyodide/project", exist_ok=True)
`);
  send("ready");
}
const ready = boot().catch(e => send("fatal", { text: String(e) }));

onmessage = async e => {
  const d = e.data;
  await ready;
  if (d.type === "config") { canInput = !!d.canInput; return; }
  if (d.type === "pip") {
    try { await py.loadPackage("micropip"); await py.pyimport("micropip").install(d.name); send("pip-done", { ok: true, name: d.name }); }
    catch (err) { send("pip-done", { ok: false, name: d.name, text: String(err.message || err) }); }
    return;
  }
  if (d.type !== "run") return;
  const t0 = performance.now();
  try {
    const all = d.files.map(f => f.code).join("\n");
    send("status", { text: "Loading packages…" });
    await py.loadPackagesFromImports(all);
    const usesPlt = /matplotlib/.test(all);
    py.globals.set("__files", py.toPy(d.files));
    py.globals.set("__main", d.main);
    send("status", { text: "Running…" });
    py.runPython(`
import os, sys, runpy, traceback
D = "/home/pyodide/project"
for f in os.listdir(D):
    p = os.path.join(D, f)
    if os.path.isfile(p): os.remove(p)
for f in __files:
    open(os.path.join(D, f["name"]), "w").write(f["code"])
os.chdir(D)
if D not in sys.path: sys.path.insert(0, D)
for f in __files:
    sys.modules.pop(f["name"].rsplit(".", 1)[0], None)
${usesPlt ? 'import matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.close("all")\nplt.show = lambda *a, **k: None' : ''}
try:
    runpy.run_path(os.path.join(D, __main), run_name="__main__")
except StopProgram as e:
    print(e)
except SystemExit:
    pass
except KeyboardInterrupt:
    print("\\n[Stopped]")
except BaseException as e:
    te = traceback.TracebackException.from_exception(e)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if "runpy" not in f.filename and not f.filename.startswith("<")])
    print("".join(te.format()).replace(D + "/", ""), file=sys.stderr, end="")
sys.stdout.flush(); sys.stderr.flush()
`);
    if (usesPlt) {
      const imgs = py.runPython(`
import io, base64, matplotlib.pyplot as plt
_o=[]
for n in plt.get_fignums():
    b=io.BytesIO(); plt.figure(n).savefig(b, format="png", dpi=110, bbox_inches="tight"); _o.append(base64.b64encode(b.getvalue()).decode())
plt.close("all")
_o`).toJs();
      imgs.forEach(s => send("plot", { data: s }));
    }
  } catch (err) { send("err", { text: String(err.message || err) + "\n" }); }
  send("done", { ms: Math.round(performance.now() - t0) });
};
