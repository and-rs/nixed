import addURLs from "./add-urls.js";

export default async function getTabs() {
	const [tabs, [active]] = await Promise.all([
		chrome.tabs.query({}),
		chrome.tabs.query({active: true, lastFocusedWindow: true})
	]);
	const popupURL = chrome.runtime.getURL("popup.html");
	return tabs
		.filter(tab => tab.id !== active?.id && tab.url !== popupURL)
		.map(tab => addURLs({
			...tab,
			kind: "tab",
			lastVisit: tab.lastAccessed || 0,
			otherWindow: tab.windowId !== active?.windowId
		}))
		.sort((a, b) => b.lastVisit - a.lastVisit);
}
