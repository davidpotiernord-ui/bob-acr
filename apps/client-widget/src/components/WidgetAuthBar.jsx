import React, { useEffect, useState } from "react";
function getApiOrigin() {
  const raw = (import.meta.env.VITE_BOB_API_URL || "https://bob-acr-api.osc-fr1.scalingo.io").replace(/\/+$/, "");
  return raw.endsWith("/api") ? raw.slice(0, -4) : raw;
}
function consumeHashToken() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  const m = hash.match(/bob_token=([^&]+)/);
  if (!m) return null;
  const tok = decodeURIComponent(m[1]);
  window.localStorage?.setItem("bob_widget_session_token", tok);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return tok;
}
export default function WidgetAuthBar({ onAuthChange }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(window.localStorage?.getItem("bob_widget_session_user") || "null"); } catch { return null; }
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [discovery, setDiscovery] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const tok = consumeHashToken() || window.localStorage?.getItem("bob_widget_session_token") || "";
    if (!tok) return;
    fetch(getApiOrigin() + "/auth/me", { headers: { Authorization: "Bearer " + tok } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) {
          setUser(d.user);
          window.localStorage?.setItem("bob_widget_session_user", JSON.stringify(d.user));
          onAuthChange?.(d);
        }
      }).catch(() => {});
  }, []);
  async function handleDiscover(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const redirectUri = typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined;
      const res = await fetch(getApiOrigin() + "/auth/discover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), redirectUri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Organisation introuvable");
      setDiscovery(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function handleLogin(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const res = await fetch(getApiOrigin() + "/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Identifiants invalides");
      window.localStorage?.setItem("bob_widget_session_token", data.token);
      window.localStorage?.setItem("bob_widget_session_user", JSON.stringify(data.user));
      setUser(data.user); setPassword(""); setOpen(false); onAuthChange?.(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function handleLogout() {
    const tok = window.localStorage?.getItem("bob_widget_session_token") || "";
    if (tok) await fetch(getApiOrigin() + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + tok } }).catch(() => {});
    window.localStorage?.removeItem("bob_widget_session_token");
    window.localStorage?.removeItem("bob_widget_session_user");
    setUser(null); setDiscovery(null); onAuthChange?.(null);
  }
  return (
    <div style={{ padding: "6px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user ? user.email + " (" + user.tenantName + ")" : "Connexion clé / SSO ou email"}
        </span>
        {user ? (
          <button type="button" onClick={handleLogout} style={{ cursor: "pointer", padding: "2px 8px", fontSize: 11 }}>Déconnexion</button>
        ) : (
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer", padding: "2px 8px", fontSize: 11, background: "#0f172a", color: "#fff", border: 0, borderRadius: 4 }}>SSO / Email</button>
        )}
      </div>
      {open && !user && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #cbd5e1" }}>
          <form onSubmit={handleDiscover} style={{ display: "flex", gap: 6 }}>
            <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setDiscovery(null); }} placeholder="email@organisation.fr" style={{ flex: 1, padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #cbd5e1" }} />
            <button type="submit" disabled={busy} style={{ padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{busy ? "..." : "Détecter"}</button>
          </form>
          {discovery?.mode === "sso" && (
            <div style={{ marginTop: 6 }}>
              <a href={discovery.loginUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", padding: "5px 10px", background: "#1d4ed8", color: "#fff", borderRadius: 4, textDecoration: "none", fontSize: 11, fontWeight: 600 }}>Connexion SSO ({discovery.ssoProvider})</a>
            </div>
          )}
          {discovery?.mode === "local_email" && (
            <form onSubmit={handleLogin} style={{ marginTop: 6, display: "flex", gap: 6 }}>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" style={{ flex: 1, padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #cbd5e1" }} />
              <button type="submit" disabled={busy} style={{ padding: "4px 10px", fontSize: 11, background: "#059669", color: "#fff", border: 0, borderRadius: 4, cursor: "pointer" }}>Connexion</button>
            </form>
          )}
          {error && <div style={{ color: "#b91c1c", marginTop: 4, fontSize: 11 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}