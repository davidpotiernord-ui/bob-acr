const MENU_ID = "bob-acr-selection-menu";

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

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  reinjectContentScripts();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error("Erreur setPanelBehavior:", err));
  }
});

chrome.runtime.onStartup?.addListener(() => {
  ensureContextMenu();
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

const BOB_DEFAULT_API = "https://bob-acr-api.osc-fr1.scalingo.io";

async function refreshBobPushBadge() {
  try {
    const cfg = await new Promise((resolve) => {
      if (chrome.storage?.managed) {
        chrome.storage.managed.get(["api_key", "api_url", "user_email"], (items) => resolve(items || {}));
      } else resolve({});
    });
    const baseUrl = (cfg.api_url || BOB_DEFAULT_API).replace(/\/+$/, "");
    const userEmail = cfg.user_email || "salarie.demo@atelier-sud.fr";
    const headers = cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {};
    const res = await fetch(`${baseUrl}/api/widget/pushes/pending?user=${encodeURIComponent(userEmail)}`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    const count = Number(data.unreadCount || (data.pushes ? data.pushes.length : 0));
    if (chrome.action?.setBadgeText) {
      await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
      if (count > 0 && chrome.action.setBadgeBackgroundColor) {
        await chrome.action.setBadgeBackgroundColor({ color: "#e11d48" });
      }
    }
  } catch {}
}

chrome.alarms?.create("bob-poll-pushes", { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "bob-poll-pushes") refreshBobPushBadge();
});
chrome.runtime.onInstalled.addListener(() => refreshBobPushBadge());
chrome.runtime.onStartup?.addListener(() => refreshBobPushBadge());
