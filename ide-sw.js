// Skull Dev Ops IDE helper: lets the Python worker wait for keyboard input and sleep.
// It only answers requests under /__ide/; everything else goes to the network as usual.
const VERSION = "8"; // bump with run.html so phones pick up the new IDE
const waiting = new Map();
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "answer" && waiting.has(d.id)) { waiting.get(d.id)(d.value); waiting.delete(d.id); }
  if (d.type === "ping" && e.source) e.source.postMessage({ type: "pong" });
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !u.pathname.startsWith("/__ide/")) return;
  if (u.pathname === "/__ide/sleep") {
    const ms = Math.min(+u.searchParams.get("ms") || 0, 60000);
    e.respondWith(new Promise(r => setTimeout(() => r(new Response("ok", { headers: { "Cache-Control": "no-store" } })), ms)));
    return;
  }
  if (u.pathname === "/__ide/input") {
    const id = u.searchParams.get("id"), client = u.searchParams.get("client");
    e.respondWith((async () => {
      const value = await new Promise(async res => {
        waiting.set(id, res);
        const all = await self.clients.matchAll({ type: "window" });
        const target = all.find(c => c.id === client) || all.find(c => /\/run(\.html)?$/.test(new URL(c.url).pathname));
        (target ? [target] : all).forEach(c => c.postMessage({ type: "input", id }));
      });
      return new Response(value === null ? "\u0000CANCEL" : String(value), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    })());
  }
});
