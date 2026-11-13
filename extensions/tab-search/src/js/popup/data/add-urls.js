export default function addURLs(item) {
	const url = item.url || item.pendingUrl || "";
	let displayURL = url;
	try {
		displayURL = decodeURIComponent(url);
	} catch {
		// Malformed percent escapes must not hide an otherwise valid tab.
	}
	return {
		...item,
		url,
		title: item.title || url || "Untitled tab",
		displayURL: displayURL.replace(/^(https?:\/\/)?(www\.)?/, ""),
		faviconURL: chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`)
	};
}
