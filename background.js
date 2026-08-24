// background.js — Service worker for X Post Cleaner

// Badge management
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab) {
    if (msg.type === 'progress') {
      chrome.action.setBadgeText({ text: '...', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0', tabId: sender.tab.id });
    }
    if (msg.type === 'done') {
      chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#00ba7c', tabId: sender.tab.id });
      // Clear badge after 3 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
      }, 3000);
    }
    if (msg.type === 'error') {
      chrome.action.setBadgeText({ text: '!', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#f4212e', tabId: sender.tab.id });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
      }, 3000);
    }
  }
});

// Extension install handler
chrome.runtime.onInstalled.addListener(() => {
  console.log('[X Post Cleaner] Extension installed');
});
