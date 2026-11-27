const MENU_ID = "bob-acr-selection-menu";
const BOB_DEFAULT_API = "https://bob-acr-api.osc-fr1.scalingo.io";
const BOB_DEFAULT_API_KEY = "bob_client_aedde88bc44f30df450d3ea04f595c8c8dd416282ce4d8d0";
const BOB_DEFAULT_USER_EMAIL = "salarie.demo@atelier-sud.fr";

function ensureContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "BOB — Assistant Conformité",
      contexts: ["selection"],
    });
  });
}

async function reinjectContentScripts() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        }).catch(() => {});
      }
    }
  } catch {}
}

async function readExtensionConfig() {
  const localCfg = await new Promise((resolve) => {
    if (chrome.storage?.local) {
      chrome.storage.local.get(null, (items) => resolve(items || {}));
    } else resolve({});
  });
  const managedCfg = await new Promise((resolve) => {
    if (chrome.storage?.managed) {
      chrome.storage.managed.get(["api_key", "api_url", "user_email"], (items) => resolve(items || {}));
    } else resolve({});
  });
  const apiUrl = String(
    managedCfg.api_url || localCfg.bob_api_url || localCfg.api_url || BOB_DEFAULT_API
  ).replace(/\/+$/, "");
  const sessionToken = String(localCfg.bob_widget_session_token || "").trim();
  const sessionUserEmail = String(localCfg.bob_widget_session_user?.email || "").trim();
  const apiKey = String(
    sessionToken || managedCfg.api_key || localCfg.bob_api_key || localCfg.api_key || BOB_DEFAULT_API_KEY
  );
  const userEmail = String(
    sessionUserEmail || managedCfg.user_email || localCfg.bob_user_email || localCfg.user_email || BOB_DEFAULT_USER_EMAIL
  );
  const trackedRaw =
    localCfg.bobTrackedEscalations ||
    localCfg.bob_tracked_escalations ||
    localCfg.trackedEscalations ||
    [];
  const queryIds = Array.isArray(trackedRaw)
    ? trackedRaw.map((i) => (typeof i === "string" ? i : i?.query_id || i?.id)).filter(Boolean)
    : [];
  return { apiUrl, apiKey, userEmail, queryIds };
}

async function refreshBobPushBadge() {
  try {
    if (!chrome.action?.setBadgeText) return;
    const { apiUrl, apiKey, userEmail, queryIds } = await readExtensionConfig();
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    const [pushRes, escRes] = await Promise.all([
      fetch(`${apiUrl}/api/widget/pushes/pending?user=${encodeURIComponent(userEmail)}`, { headers }).catch(() => null),
      fetch(`${apiUrl}/api/escalations/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query_ids: queryIds }),
      }).catch(() => null),
    ]);

    let pushCount = 0;
    if (pushRes && pushRes.ok) {
      const pData = await pushRes.json().catch(() => ({}));
      pushCount = Number(pData.unreadCount ?? (Array.isArray(pData.pushes) ? pData.pushes.length : 0)) || 0;
    }

    let unreadRepliesCount = 0;
    if (escRes && escRes.ok) {
      const eData = await escRes.json().catch(() => ({}));
      const items = Array.isArray(eData.items) ? eData.items : [];
      unreadRepliesCount = items.filter((i) => i.referent_answer && !i.referent_acknowledged_at).length;
    }

    const total = pushCount + unreadRepliesCount;
    await chrome.storage?.local?.set({ bobBadgeCount: total }).catch(() => {});
    chrome.tabs?.query?.({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
      for (const tab of tabs || []) {
        if (typeof tab.id === "number") {
          chrome.tabs.sendMessage(tab.id, { type: "BOB_SET_OVERLAY_BADGE", count: total }).catch(() => {});
        }
      }
    });
    await chrome.storage?.local?.set({ bobBadgeCount: total }).catch(() => {});
    await chrome.action.setBadgeText({ text: total > 0 ? String(total) : "" });
    if (total > 0 && chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({
        color: unreadRepliesCount > 0 ? "#059669" : "#e11d48",
      });
    }
  } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  reinjectContentScripts();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error("Erreur setPanelBehavior:", err));
  }
  chrome.alarms?.create("bob-poll-pushes", { periodInMinutes: 1 });
  refreshBobPushBadge();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureContextMenu();
  chrome.alarms?.create("bob-poll-pushes", { periodInMinutes: 1 });
  refreshBobPushBadge();
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const selectedText = (info.selectionText || "").trim();
  if (!selectedText) return;

  const payload = {
    text: selectedText,
    pageUrl: info.pageUrl || tab?.url || "",
    capturedAt: Date.now(),
  };

  await chrome.storage.local.set({ bobPendingSelection: payload });

  if (tab && typeof tab.id === "number") {
    const msg = { type: "BOB_OPEN_OVERLAY_WITH_SELECTION", payload };
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        await chrome.tabs.sendMessage(tab.id, msg);
      } catch (err) {
        console.warn("Impossible d ouvrir le panneau flottant sur cet onglet:", err);
      }
    }
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && tab && typeof tab.windowId === "number") {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

chrome.alarms?.create("bob-poll-pushes", { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "bob-poll-pushes") refreshBobPushBadge();
});
chrome.storage?.onChanged?.addListener(() => {
  refreshBobPushBadge();
});

chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "BOB_OPEN_SIDEPANEL") {
    const winId = _sender?.tab?.windowId;
    if (chrome.sidePanel && typeof winId === "number") {
      chrome.sidePanel.open({ windowId: winId })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    sendResponse({ ok: false, error: "sidePanel indisponible" });
    return true;
  }
  if (msg?.type === "BOB_GET_BADGE") {
    Promise.resolve(refreshBobPushBadge()).then(() => {
      chrome.storage?.local?.get(["bobBadgeCount"], (res) => {
        sendResponse({ count: Number(res?.bobBadgeCount) || 0 });
      });
    });
    return true;
  }
});
