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
    btn.textContent = "BOB Conformité";
    btn.style.cssText =
      "background:#4f46e5;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,0.25);cursor:pointer;";

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

    btn.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
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
