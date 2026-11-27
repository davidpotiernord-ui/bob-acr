(() => {
  const ROOT_ID = "bob-acr-overlay-root";
  const PANEL_ID = "bob-acr-overlay-panel";

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
  }

  let embedBundlePromise = null;
  function loadEmbedBundle() {
    if (typeof window.mountBobShadowWidget === "function") {
      return Promise.resolve();
    }
    if (!chrome.runtime?.id) {
      return Promise.reject(new Error("Contexte extension expiré : rechargez la page (Cmd+R)."));
    }
    if (!embedBundlePromise) {
      let url;
      try {
        url = chrome.runtime.getURL("widget-embed.js");
      } catch (err) {
        return Promise.reject(new Error("Contexte extension expiré : rechargez la page (Cmd+R)."));
      }
      embedBundlePromise = import(url).catch((err) => {
        embedBundlePromise = null;
        throw err;
      });
    }
    return embedBundlePromise;
  }

  function ensureOverlay() {
    const mountTarget = document.documentElement || document.body;
    if (!mountTarget) return { panel: null, shadow: null };

    let host = document.getElementById(ROOT_ID);
    if (host) {
      const existingPanel = document.getElementById(PANEL_ID);
      return {
        panel: existingPanel,
        shadow: existingPanel?.shadowRoot || null,
      };
    }

    host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;";

    const btn = document.createElement("button");
    btn.type = "button";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = "BOB Conformité";
    const badgeEl = document.createElement("span");
    badgeEl.id = "bob-acr-overlay-badge";
    badgeEl.style.cssText =
      "display:none;position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e11d48;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;box-shadow:0 2px 8px rgba(15,23,42,0.35);pointer-events:none;";
    btn.appendChild(labelSpan);
    btn.appendChild(badgeEl);

    const setOverlayBadge = (count) => {
      const n = Number(count) || 0;
      badgeEl.textContent = n > 0 ? String(n) : "";
      badgeEl.style.display = n > 0 ? "inline-block" : "none";
    };

    try { if (chrome.runtime?.id) chrome.storage?.local?.get(["bobBadgeCount"], (res) => {
      if (!chrome.runtime?.lastError && typeof res?.bobBadgeCount === "number") setOverlayBadge(res.bobBadgeCount);
    }); } catch {}
    chrome.storage?.onChanged?.addListener((changes) => {
      if (changes.bobBadgeCount) setOverlayBadge(changes.bobBadgeCount.newValue);
    });
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.type === "BOB_SET_OVERLAY_BADGE") setOverlayBadge(msg.count);
    });

    btn.style.cssText =
      "background:#4f46e5;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,0.25);cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:6px;";

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText =
      "display:none;position:fixed;right:20px;bottom:72px;z-index:2147483647;width:420px;height:640px;max-height:84vh;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 20px 45px rgba(15,23,42,0.3);overflow:hidden;";

    const shadow = panel.attachShadow({ mode: "open" });

    const styleLink = document.createElement("link");
    styleLink.rel = "stylesheet";
    try { if (chrome.runtime?.id) styleLink.href = chrome.runtime.getURL("widget-embed.css"); } catch {}
    shadow.appendChild(styleLink);

    const resetStyle = document.createElement("style");
    resetStyle.textContent =
      ":host { all: initial; font-family: system-ui, -apple-system, sans-serif; } #bob-shadow-react-root { width: 100%; height: 100%; }";
    shadow.appendChild(resetStyle);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Fermer BOB");
    closeBtn.title = "Fermer (Échap)";
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "position:absolute;top:8px;right:10px;z-index:50;width:26px;height:26px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.75);color:#fff;font-size:16px;line-height:22px;text-align:center;cursor:pointer;";
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
    shadow.appendChild(closeBtn);

    let mounted = false;
    const ensureWidgetMounted = async () => {
      if (mounted) return;
      try {
        await loadEmbedBundle();
        if (typeof window.mountBobShadowWidget === "function") {
          window.mountBobShadowWidget(shadow);
          mounted = true;
        }
      } catch (err) {
        const fallback = document.createElement("div");
        fallback.style.cssText = "padding:16px;font-size:13px;color:#b91c1c;background:#fef2f2;";
        fallback.textContent = "Extension mise à jour : rechargez la page (Cmd + R) pour réactiver BOB.";
        shadow.appendChild(fallback);
        throw err;
      }
    };

    btn.addEventListener("click", async () => {
      const opening = panel.style.display === "none";
      panel.style.display = opening ? "block" : "none";
      if (opening) {
        await ensureWidgetMounted().catch((e) => console.error("BOB mount error:", e));
        window.postMessage({ type: "BOB_PANEL_OPENED" }, "*");
      }
    });

    host.appendChild(btn);
    host.appendChild(panel);
    try { mountTarget.appendChild(host); } catch (err) { console.error("BOB mountTarget appendChild error:", err); }
    return { panel, shadow, ensureWidgetMounted };
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const panel = document.getElementById(PANEL_ID);
      if (panel && panel.style.display === "block") {
        panel.style.display = "none";
      }
    }
  });

  const bobBadgeInterval = setInterval(() => {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime?.sendMessage?.({ type: "BOB_GET_BADGE" }, (res) => {
        if (chrome.runtime?.lastError) return;
        const badgeEl = document.getElementById("bob-acr-overlay-badge");
        if (badgeEl && typeof res?.count === "number") {
          badgeEl.textContent = res.count > 0 ? String(res.count) : "";
          badgeEl.style.display = res.count > 0 ? "inline-block" : "none";
        }
      });
    } catch {}
    if (!chrome.runtime?.id) {
      clearInterval(bobBadgeInterval);
    }
  }, 5000);

  ensureOverlay();

  const bobEnsureInterval = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(bobEnsureInterval);
      return;
    }
    if ((document.documentElement || document.body) && !document.getElementById(ROOT_ID)) {
      ensureOverlay();
    }
  }, 1500);

  if (chrome.runtime?.id && chrome.runtime?.onMessage?.addListener) { try { chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "BOB_OPEN_OVERLAY_WITH_SELECTION") {
      const { panel, ensureWidgetMounted } = ensureOverlay();
      if (panel) panel.style.display = "block";
      Promise.resolve(ensureWidgetMounted?.()).then(() => {
        if (msg.payload) {
          window.postMessage({ type: "BOB_SELECTION_PAYLOAD", payload: msg.payload }, "*");
        }
      });
    }
    });
  } catch (err) { console.error("BOB onMessage error:", err); }
}
})();
