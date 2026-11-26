(() => {
  const ROOT_ID = "bob-acr-overlay-root";
  const PANEL_ID = "bob-acr-overlay-panel";
  const IFRAME_ID = "bob-acr-overlay-iframe";

  // Nettoyer une éventuelle instance orpheline après rechargement de lextension
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
  }

  function ensureOverlay() {
    let host = document.getElementById(ROOT_ID);
    if (host) {
      return {
        panel: document.getElementById(PANEL_ID),
        iframe: document.getElementById(IFRAME_ID),
      };
    }

    host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.position = "relative";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = "BOB Conformité";
    const badgeEl = document.createElement("span");
    badgeEl.id = "bob-acr-overlay-badge";
    badgeEl.style.cssText = "display:none;position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e11d48;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;box-shadow:0 2px 8px rgba(15,23,42,0.35);pointer-events:none;";
    btn.appendChild(labelSpan);
    btn.appendChild(badgeEl);
    const setOverlayBadge = (count) => {
      const n = Number(count) || 0;
      badgeEl.textContent = n > 0 ? String(n) : "";
      badgeEl.style.display = n > 0 ? "inline-block" : "none";
    };
    chrome.storage?.local?.get(["bobBadgeCount"], (res) => {
      if (typeof res?.bobBadgeCount === "number") setOverlayBadge(res.bobBadgeCount);
    });
    chrome.storage?.onChanged?.addListener((changes) => {
      if (changes.bobBadgeCount) setOverlayBadge(changes.bobBadgeCount.newValue);
    });
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.type === "BOB_SET_OVERLAY_BADGE") setOverlayBadge(msg.count);
    });
    btn.style.cssText = "background:#4f46e5;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,0.25);cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:6px;";

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText =
      "display:none;position:fixed;right:20px;bottom:72px;width:420px;height:640px;max-height:84vh;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 20px 45px rgba(15,23,42,0.3);overflow:hidden;";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Fermer BOB");
    closeBtn.title = "Fermer (Échap)";
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "position:absolute;top:8px;right:10px;z-index:10;width:26px;height:26px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.75);color:#fff;font-size:16px;line-height:22px;text-align:center;cursor:pointer;";

    const iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.src = chrome.runtime.getURL("index.html");
    iframe.style.cssText = "width:100%;height:100%;border:0;";

    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });

    setInterval(() => {


      try {


        chrome.runtime?.sendMessage?.({ type: "BOB_GET_BADGE" }, (res) => {


          if (chrome.runtime?.lastError) return;


          if (typeof res?.count === "number") setOverlayBadge(res.count);


        });


      } catch {}


    }, 5000);


    btn.addEventListener("click", () => {
      const opening = panel.style.display === "none";
      panel.style.display = opening ? "block" : "none";
      if (opening && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "BOB_PANEL_OPENED" }, "*");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panel.style.display === "block") {
        panel.style.display = "none";
      }
    });

    panel.appendChild(closeBtn);
    panel.appendChild(iframe);
    host.appendChild(btn);
    host.appendChild(panel);
    document.body.appendChild(host);
    return { panel, iframe };
  }

  ensureOverlay();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "BOB_OPEN_OVERLAY_WITH_SELECTION") {
      const { panel, iframe } = ensureOverlay();
      if (panel) panel.style.display = "block";
      if (iframe && iframe.contentWindow && msg.payload) {
        const sendToIframe = () => {
          iframe.contentWindow?.postMessage(
            { type: "BOB_SELECTION_PAYLOAD", payload: msg.payload },
            "*"
          );
        };
        sendToIframe();
        setTimeout(sendToIframe, 250);
      }
    }
  });
})();
