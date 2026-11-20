function notifyNavigation(details) {
	if (details.frameId !== 0) return;
	if (["reddit.com", "www.reddit.com", "new.reddit.com", "sh.reddit.com"].includes(new URL(details.url).hostname)) {
		chrome.tabs.sendMessage(details.tabId, {type: "browsing-navigation"}).catch(() => {});
	}
}

chrome.webNavigation.onHistoryStateUpdated.addListener(notifyNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(notifyNavigation);
