const assert = require("node:assert/strict");
const {readFileSync, existsSync} = require("node:fs");
const {join} = require("node:path");
const {before, test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {createHash} = require("node:crypto");

let getTabs, getBookmarks, addURLs, scoreItems;
const runtime = {getURL: path => `chrome-extension://tab-search/${path}`};

before(async () => {
	({default: getTabs} = await import("./src/js/popup/data/init-tabs.js"));
	({default: getBookmarks} = await import("./src/js/popup/data/get-bookmarks.js"));
	({default: addURLs} = await import("./src/js/popup/data/add-urls.js"));
	({default: scoreItems} = await import("./src/js/popup/score/score-items.js"));
});

test("only the toolbar action and necessary permissions remain", () => {
	const manifest = JSON.parse(readFileSync(join(__dirname, "src/manifest.json"), "utf8"));
	assert.deepEqual(manifest.permissions, ["tabs", "bookmarks", "favicon"]);
	assert.deepEqual(Object.keys(manifest.commands), ["_execute_action"]);
	assert.deepEqual(manifest.commands._execute_action.suggested_key, {default: "Ctrl+O", mac: "Command+O"});
	assert.ok(!manifest.background && !manifest.options_ui && !manifest.content_scripts);
	const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
	const id = [...digest].map(char => String.fromCharCode(97 + parseInt(char, 16))).join("");
	assert.equal(id, "mmfbflaekjfllceokohbkjafnljjgafl", "source manifest preserves the installed extension identity");
	for (const path of [manifest.action.default_popup, ...Object.values(manifest.icons)]) {
		assert.ok(existsSync(join(__dirname, "src", path)), path);
	}
});

test("all other open tabs survive, including unvisited, discarded and frozen tabs across windows", async () => {
	const live = [
		{id: 1, windowId: 10, title: "Active", url: "https://active/", lastAccessed: 300},
		{id: 2, windowId: 10, title: "Older", url: "https://older/", lastAccessed: 100},
		{id: 3, windowId: 20, title: "Recent", url: "https://recent/", lastAccessed: 200},
		...Array.from({length: 15}, (_, i) => ({id: i + 4, windowId: 20, url: `https://hibernated-${i}/`, discarded: true, frozen: true})),
		{id: 99, windowId: 10, url: runtime.getURL("popup.html")}
	];
	global.chrome = {runtime, tabs: {query: async query => structuredClone(query.active ? [live[0]] : live)}};
	const tabs = await getTabs();
	assert.deepEqual(tabs.map(tab => tab.id), [3, 2, ...live.slice(3, -1).map(tab => tab.id)]);
	assert.equal(tabs[0].otherWindow, true);
	assert.equal(tabs[1].otherWindow, false);
	assert.equal(tabs.filter(tab => tab.discarded && tab.frozen).length, 15);
	assert.equal(scoreItems(tabs, "").length, 17);
	assert.equal(scoreItems(tabs, "hibernated").length, 15);
	live.splice(1, 1);
	assert.ok(!(await getTabs()).some(tab => tab.id === 2));
});

test("tab query failures propagate instead of yielding stale results", async () => {
	const error = new Error("browser unavailable");
	global.chrome = {runtime, tabs: {query: async () => { throw error; }}};
	await assert.rejects(getTabs(), error);
});

test("no other tabs produces an empty list, including when no active tab exists", async () => {
	global.chrome = {runtime, tabs: {query: async () => []}};
	assert.deepEqual(await getTabs(), []);
	const active = {id: 1, url: "https://active/"};
	chrome.tabs.query = async () => [active];
	assert.deepEqual(await getTabs(), []);
});

test("pending URLs, missing titles, malformed escapes and favicon URL encoding are safe", () => {
	global.chrome = {runtime};
	const item = addURLs({pendingUrl: "https://www.example/%bad?x=1&size=99"});
	assert.equal(item.url, "https://www.example/%bad?x=1&size=99");
	assert.equal(item.title, item.url);
	assert.equal(item.displayURL, "example/%bad?x=1&size=99");
	assert.equal(new URL(item.faviconURL).searchParams.get("pageUrl"), item.url);
	assert.equal(new URL(item.faviconURL).searchParams.get("size"), "32");
	assert.equal(addURLs({}).title, "Untitled tab");
});

test("bookmark search retains folder paths, deduplicates URLs and never mutates the tree", async () => {
	const tree = [{id: "0", children: [{id: "1", parentId: "0", title: "Bookmarks bar", children: [
		{id: "2", parentId: "1", title: "Work", children: [
			{id: "3", title: "Project docs", url: "https://example/docs"},
			{id: "4", title: "Duplicate", url: "https://example/docs"}
		]},
		{id: "5", title: "中文", url: "https://example/chinese"}
	]}]}];
	const original = structuredClone(tree);
	global.chrome = {runtime, bookmarks: {getTree: async () => tree}};
	const [a, b] = await Promise.all([getBookmarks(), getBookmarks()]);
	assert.equal(a.length, 2);
	assert.deepEqual(a, b);
	assert.deepEqual(tree, original);
	assert.equal(a.find(item => item.id === "3").title, "Work / Project docs");
	assert.ok(a.every(item => item.kind === "bookmark"));
	assert.equal(scoreItems(a, "work docs").length, 1);
	assert.equal(scoreItems(a, "中文").length, 1);
	chrome.bookmarks.getTree = async () => { throw new Error("denied"); };
	await assert.rejects(getBookmarks(), /denied/);
});

test("upstream fuzzy matching handles multiple tokens, highlights and long queries without reordering the source", () => {
	global.chrome = {runtime};
	const items = [
		addURLs({title: "Project Documentation", url: "https://example/api", lastVisit: 100}),
		addURLs({title: "Unrelated", url: "https://other/", lastVisit: 200})
	];
	assert.equal(scoreItems(items, "prj doc")[0].title, "Project Documentation");
	assert.equal(scoreItems(items, "PROJECT api").length, 1);
	assert.ok(items[0].hitMasks.title.length);
	assert.equal(items[0].title, "Project Documentation");
	assert.equal(scoreItems(items, "not-found-anywhere").length, 0);
	assert.equal(scoreItems(items, "  "), items);
	const long = "a sufficiently long literal phrase for matching";
	assert.equal(scoreItems([addURLs({title: long, url: "https://example/"})], long).length, 1);
});

test("popup refresh preserves selection by identity; removal clamps and a new query resets it", async () => {
	class Element {
		children = [];
		attributes = {};
		listeners = {};
		value = "";
		classList = {toggle() {}};
		append(...nodes) { this.children.push(...nodes); }
		replaceChildren(fragment) { this.children = fragment ? [...fragment.children] : []; }
		setAttribute(key, value) { this.attributes[key] = value; }
		removeAttribute(key) { delete this.attributes[key]; }
		addEventListener(name, callback) { this.listeners[name] = callback; }
		scrollIntoView() {}
		focus() {}
	}
	const search = new Element();
	const results = new Element();
	const status = new Element();
	const event = () => ({addListener(callback) { this.callback = callback; }});
	const tab = id => ({id, kind: "tab", title: `Tab ${id}`, displayURL: "example", windowId: 1});
	let tabs = [tab(1), tab(2), tab(3)];
	let opened;
	const chrome = {
		tabs: Object.fromEntries(["onCreated", "onUpdated", "onRemoved", "onAttached", "onDetached", "onActivated"].map(name => [name, event()])),
		bookmarks: Object.fromEntries(["onCreated", "onChanged", "onRemoved", "onMoved"].map(name => [name, event()])),
		windows: {update: async () => {}}
	};
	chrome.tabs.update = async id => { opened = id; };
	const source = readFileSync(join(__dirname, "src/js/popup/main.js"), "utf8")
		.replace(/^import .*;\n/gm, "");
	await runInNewContext(`${source}\nready;`, {
		chrome,
		getTabs: async () => structuredClone(tabs),
		getBookmarks: async () => [],
		scoreItems: items => items,
		window: {close() {}},
		document: {
			querySelector: selector => ({"#search": search, "#results": results, "#status": status})[selector],
			createElement: () => new Element(),
			createTextNode: () => new Element(),
			createDocumentFragment: () => new Element()
		}
	});
	const key = key => search.listeners.keydown({key, preventDefault() {}});
	const selectedIndex = () => results.children.findIndex(row => row.attributes["aria-selected"]);
	await key("ArrowDown");
	assert.equal(selectedIndex(), 1);
	tabs = [tab(3), tab(1), tab(2)];
	await chrome.tabs.onUpdated.callback();
	assert.equal(selectedIndex(), 2, "selection follows tab 2 after reordering");
	await key("Enter");
	assert.equal(opened, 2, "Enter opens the retained tab, not the first result");
	tabs = [tab(3), tab(1)];
	await chrome.tabs.onRemoved.callback();
	assert.equal(selectedIndex(), 1, "removed selection clamps to the remaining last row");
	search.value = "new query";
	search.listeners.input();
	assert.equal(selectedIndex(), 0, "typing selects the first match");
	tabs = [];
	await chrome.tabs.onRemoved.callback();
	assert.equal(results.children.length, 0);
	assert.equal(search.attributes["aria-activedescendant"], undefined);
});

test("search preserves literal and Unicode matching with a bounded cache", () => {
	const caches = [];
	class TrackedMap extends Map {
		constructor(entries) { super(entries); caches.push(this); }
	}
	const source = readFileSync(join(__dirname, "src/js/popup/score/search.js"), "utf8")
		.replace("export function search", "function search");
	const search = runInNewContext(`${source}\nsearch;`, {Map: TrackedMap});
	assert.equal(search("École", "é"), 0);
	assert.equal(search("ÉCOLE", "école"), 0);
	assert.equal(search("中文", "文"), 1);
	assert.equal(search("a.b[c]", ".b["), 1);
	assert.equal(search("aXb", ".b"), -1);
	for (let i = 0; i < 1100; i++) search(`query-${i}`, `query-${i}`);
	const cache = caches[1];
	assert.equal(cache.size, 1000);
	assert.ok(!cache.has("query-0"));
	search("query-100", "query-100");
	search("another query", "another query");
	assert.ok(cache.has("query-100"), "cache hits retain recently used entries");
	assert.equal(cache.size, 1000);
});
