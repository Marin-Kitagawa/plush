/* Plush · badge + keyboard command */

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'badge' && sender.tab) {
    chrome.action.setBadgeBackgroundColor({ color: '#C96F5E' });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text || '' });
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});

chrome.commands.onCommand.addListener(async (name) => {
  if (name !== 'open-find') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'find' }).catch(() => {});
});
