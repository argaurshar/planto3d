"use client";

import { useEffect, useState } from "react";
import { getRenderServer, RENDER_SERVER_EVENT, serverHealth, setRenderServer, type ServerHealth } from "@/lib/room/renderServer";

/**
 * Bottom-of-page setting for the Blender render server: its address and token.
 * Saved only in this browser. "Test" checks the server and the token.
 */
export default function RenderServerManager() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = getRenderServer();
    setUrl(s?.url ?? "");
    setToken(s?.token ?? "");
    setConfigured(Boolean(s));
    setReady(true);
  }, []);

  if (!ready) return null;

  const test = async (save: boolean) => {
    setBusy(true);
    setStatus(null);
    setHealth(null);
    try {
      const h = await serverHealth({ url: url.trim().replace(/\/+$/, ""), token: token.trim() });
      setHealth(h);
      if (h.authRequired && !h.authorized) {
        setStatus("The server is up, but the token is missing or wrong.");
        return;
      }
      if (save) {
        setRenderServer({ url, token });
        setConfigured(true);
        setOpen(false);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "The test failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-neutral-300 hover:underline">
        <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-emerald-400" : "bg-neutral-500"}`} />
        {configured ? "Blender render server · change" : "Connect a Blender render server (optional)"}
      </button>
    );
  }

  return (
    <div className="card w-full max-w-md space-y-3 p-4 text-left">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-sky-300/90">Blender render server</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-1.5 text-neutral-500 transition hover:text-neutral-200">
          ✕
        </button>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void test(true);
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-render-server.example.com" className="input" autoComplete="off" inputMode="url" />
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Render token (RENDER_TOKEN on the server)" className="input" autoComplete="off" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!url.trim() || busy} className="btn-primary min-h-0 px-4 py-2 text-sm">
            {busy ? "Checking…" : "Test & save"}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => {
                setRenderServer(null);
                setConfigured(Boolean(getRenderServer()));
                setUrl(getRenderServer()?.url ?? "");
                setToken("");
                setHealth(null);
              }}
              className="btn-ghost text-xs"
            >
              Forget
            </button>
          )}
        </div>
      </form>
      {health && (!health.authRequired || health.authorized) && (
        <p className="text-xs text-emerald-300">
          Connected: Blender {health.blender ?? "?"} · {health.device ?? "auto"} · {health.queue} in queue
        </p>
      )}
      {status && <p className="text-xs text-red-300">{status}</p>}
      <p className="text-[11px] leading-relaxed text-neutral-500">
        The server renders shots with real Blender Cycles from the exact model. Run it from the repo’s <span className="text-neutral-300">blender-server</span> folder on any machine or GPU host. The address and token stay in this browser.
      </p>
    </div>
  );
}
