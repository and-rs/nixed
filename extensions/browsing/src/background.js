importScripts("config.js", "logic.js");

function redirectNavigation(details) {
	if (details.frameId !== 0) return;
	const target = Browsing.redirect(details.url, browsingConfig.redirects);
	if (target) {
		chrome.tabs.update(details.tabId, {url: target}).catch(console.error);
	} else if (["reddit.com", "www.reddit.com", "new.reddit.com", "sh.reddit.com"].includes(new URL(details.url).hostname)) {
		chrome.tabs.sendMessage(details.tabId, {type: "browsing-navigation"}).catch(() => {});
	}
}

chrome.webNavigation.onHistoryStateUpdated.addListener(redirectNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(redirectNavigation);
