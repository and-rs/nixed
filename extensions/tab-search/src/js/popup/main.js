import getTabs from "./data/init-tabs.js";
import getBookmarks from "./data/get-bookmarks.js";
import scoreItems from "./score/score-items.js";

const search = document.querySelector("#search");
const list = document.querySelector("#results");
const status = document.querySelector("#status");
let tabs = [];
let bookmarksPromise;
let matches = [];
let selected = 0;
let opening = false;
let renderVersion = 0;
let refreshVersion = 0;
let pendingResults;
let renderedQuery;

function highlight(element, text, indexes = []) {
	const hits = new Set(indexes);
	for (let start = 0; start < text.length;) {
		let end = start + 1;
		while (end < text.length && hits.has(end) === hits.has(start)) end++;
		const node = hits.has(start) ? document.createElement("b") : document.createTextNode("");
		node.textContent = text.slice(start, end);
		element.append(node);
		start = end;
	}
}

function select(index) {
	selected = Math.max(0, Math.min(index, matches.length - 1));
	for (const [i, row] of Array.from(list.children).entries()) {
		row.classList.toggle("selected", i === selected);
		row.setAttribute("aria-selected", i === selected);
	}
	const row = list.children[selected];
	if (row) {
		search.setAttribute("aria-activedescendant", row.id);
		row.scrollIntoView({block: "nearest"});
	} else {
		search.removeAttribute("aria-activedescendant");
	}
}

async function updateResults() {
	const version = ++renderVersion;
	const bookmarkMode = /^\/b(?:\s|$)/i.test(search.value);
	const query = bookmarkMode ? search.value.slice(2).trimStart() : search.value;
	try {
		const items = bookmarkMode ? await (bookmarksPromise ||= getBookmarks()) : tabs;
		if (version !== renderVersion) return;
		const previous = search.value === renderedQuery ? matches[selected] : undefined;
		const previousIndex = previous ? selected : 0;
		renderedQuery = search.value;
		matches = scoreItems(items, query);
		const fragment = document.createDocumentFragment();
		for (const [index, item] of matches.entries()) {
			const row = document.createElement("div");
			row.id = `result-${index}`;
			row.className = `results-list-item ${item.kind}`;
			row.setAttribute("role", "option");
			const icon = document.createElement("img");
			icon.className = "favicon";
			icon.alt = "";
			icon.src = item.faviconURL;
			icon.addEventListener("error", () => { icon.src = "img/default-favicon.svg"; }, {once: true});
			const text = document.createElement("div");
			for (const [key, className] of [["title", "title"], ["displayURL", "url"]]) {
				const line = document.createElement("div");
				line.className = className;
				line.title = item[key];
				highlight(line, item[key], query.trim() ? item.hitMasks?.[key] : []);
				text.append(line);
			}
			const badge = document.createElement("span");
			badge.className = "badge";
			badge.textContent = item.otherWindow ? "Other window" : "";
			row.append(icon, text, badge);
			row.addEventListener("mousedown", event => event.preventDefault());
			row.addEventListener("mousemove", () => select(index));
			row.addEventListener("click", event => openItem(item, event));
			fragment.append(row);
		}
		list.replaceChildren(fragment);
		const retained = previous ? matches.findIndex(item =>
			item.kind === previous.kind && item.id === previous.id) : -1;
		select(retained >= 0 ? retained : previousIndex);
		status.textContent = matches.length
			? `${matches.length} ${bookmarkMode ? "bookmarks" : "tabs"}`
			: bookmarkMode ? "No matching bookmarks" : "No other matching open tabs";
	} catch (error) {
		if (version !== renderVersion) return;
		bookmarksPromise = undefined;
		matches = [];
		list.replaceChildren();
		status.textContent = `Could not load results: ${error.message}`;
	}
}

async function refreshTabs() {
	const version = ++refreshVersion;
	try {
		const fresh = await getTabs();
		if (version !== refreshVersion) return;
		tabs = fresh;
		await (pendingResults = updateResults());
	} catch (error) {
		if (version === refreshVersion) status.textContent = `Could not load tabs: ${error.message}`;
	}
}

async function openItem(item, event) {
	if (!item || opening) return;
	opening = true;
	try {
		if (item.kind === "tab") {
			// Dispatch both before either can dismiss the toolbar popup.
			await Promise.all([
				chrome.tabs.update(item.id, {active: true}),
				chrome.windows.update(item.windowId, {focused: true})
			]);
		} else if (event.ctrlKey || event.metaKey) {
			await chrome.tabs.create({url: item.url});
		} else {
			const [active] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
			if (active) await chrome.tabs.update(active.id, {url: item.url});
			else await chrome.tabs.create({url: item.url});
		}
		window.close();
	} catch (error) {
		opening = false;
		await refreshTabs();
		status.textContent = `Could not open result: ${error.message}`;
	}
}

search.addEventListener("input", () => { pendingResults = updateResults(); });
search.addEventListener("keydown", async event => {
	if (event.isComposing) return;
	if (event.key === "Escape") {
		event.preventDefault();
		if (search.value) {
			search.value = "";
			pendingResults = updateResults();
		} else window.close();
	} else if (event.key === "Enter") {
		event.preventDefault();
		await ready;
		await pendingResults;
		await openItem(matches[selected], event);
	} else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
		event.preventDefault();
		const step = event.key.startsWith("Page") ? 10 : 1;
		select(selected + (event.key.endsWith("Down") ? step : -step));
	}
});

for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved,
	chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated]) {
	event.addListener(refreshTabs);
}
for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged,
	chrome.bookmarks.onRemoved, chrome.bookmarks.onMoved]) {
	event.addListener(() => {
		bookmarksPromise = undefined;
		pendingResults = updateResults();
	});
}
const ready = refreshTabs();
search.focus();
