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

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
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

  await chrome.storage.local.set({
    bobPendingSelection: {
      text: selectedText,
      pageUrl: info.pageUrl || tab?.url || "",
      capturedAt: Date.now(),
    },
  });

  if (tab && typeof tab.id === "number") {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "BOB_OPEN_OVERLAY_WITH_SELECTION" });
      return;
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        await chrome.tabs.sendMessage(tab.id, { type: "BOB_OPEN_OVERLAY_WITH_SELECTION" });
        return;
      } catch {
        // Page restreinte (ex. chrome:// ou PDF natif) -> fallback sidePanel
      }
    }
  }

  if (chrome.sidePanel && tab && typeof tab.windowId === "number") {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && tab && typeof tab.windowId === "number") {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});
