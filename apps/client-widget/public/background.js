chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error('Erreur setPanelBehavior:', err));
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && tab && typeof tab.windowId === 'number') {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});
