const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = name => fs.readFileSync(path.join(__dirname, "src", name), "utf8");
const redirects = [{
	hosts: ["reddit.com", "www.reddit.com"],
	paths: ["/", "/r/popular"],
	to: "https://www.reddit.com/user/example/m/dev",
}];
const context = vm.createContext({URL});
vm.runInContext(source("logic.js"), context);
const logic = context.Browsing;

test("redirects cover root queries and popular without catching useful pages", () => {
	for (const url of ["https://reddit.com/", "https://www.reddit.com/?feed=home", "https://www.reddit.com/r/popular/?geo=US"]) {
		assert.equal(logic.redirect(url, redirects), redirects[0].to);
	}
	for (const url of [redirects[0].to, "https://www.reddit.com/r/programming/", "https://www.reddit.com.evil.example/"]) {
		assert.equal(logic.redirect(url, redirects), null);
	}
});

test("direct posts and communities use canonical metadata endpoints", () => {
	assert.equal(logic.metadataURL("https://www.reddit.com/r/example/comments/abc123/title/"),
		"https://www.reddit.com/comments/abc123.json?raw_json=1&limit=1");
	assert.equal(logic.metadataURL("https://www.reddit.com/comments/abc123/"),
		"https://www.reddit.com/comments/abc123.json?raw_json=1&limit=1");
	assert.equal(logic.metadataURL("https://www.reddit.com/r/example/new/"),
		"https://www.reddit.com/r/example/about.json?raw_json=1");
	assert.equal(logic.metadataURL("https://www.reddit.com/user/example/"),
		"https://www.reddit.com/user/example/about.json?raw_json=1");
	assert.equal(logic.metadataURL("https://www.reddit.com/u/example/comments/"),
		"https://www.reddit.com/user/example/about.json?raw_json=1");
	assert.equal(logic.metadataURL(redirects[0].to), null);
});

test("NSFW metadata supports post and community fields and rejects unknown data", () => {
	assert.equal(logic.nsfwMetadata([{data: {children: [{data: {over_18: true}}]}}]), true);
	assert.equal(logic.nsfwMetadata({data: {over18: false}}), false);
	assert.equal(logic.nsfwMetadata({data: {subreddit: {over_18: true}}}), true);
	assert.throws(() => logic.nsfwMetadata({data: {}}), /Missing NSFW metadata/);
	assert.throws(() => logic.nsfwMetadata({data: {over18: "false"}}), /Missing NSFW metadata/);
});

function page({url = redirects[0].to, metadata = {data: {over18: false}}, failed = false, gate = false, markers = []} = {}) {
	const attributes = new Set();
	const navigations = [];
	let observer;
	let message;
	const location = {href: url, replace: target => navigations.push(target)};
	const document = {
		documentElement: {
			setAttribute: name => attributes.add(name),
			removeAttribute: name => attributes.delete(name),
		},
		querySelector: () => gate ? {} : null,
		querySelectorAll: () => markers,
	};
	const sandbox = vm.createContext({
		URL, document, location, AbortController, setTimeout, clearTimeout,
		browsingConfig: {redirects},
		chrome: {runtime: {
			getURL: name => `chrome-extension://boundaries/${name}`,
			onMessage: {addListener: callback => {message = callback;}},
		}},
		fetch: async () => {
			if (failed) throw new Error("Offline");
			return {ok: true, json: async () => metadata};
		},
		MutationObserver: class {
			constructor(callback) {observer = callback;}
			observe() {}
		},
		requestAnimationFrame: callback => callback(),
		addEventListener() {},
	});
	vm.runInContext(source("logic.js"), sandbox);
	vm.runInContext(source("content.js"), sandbox);
	return {attributes, navigations, location, mutate: () => observer(), message: () => message({type: "browsing-navigation"})};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("marked cards are removed rather than blurred, including inserted cards", () => {
	let removed = 0;
	const markers = [];
	const current = page({markers});
	markers.push({closest: () => ({remove: () => removed++})});
	current.mutate();
	assert.equal(removed, 1);
	assert.deepEqual(current.navigations, []);
});

test("direct NSFW community blocks without a reveal action", async () => {
	const current = page({url: "https://www.reddit.com/r/example/", metadata: {data: {over18: true}}});
	assert.equal(current.attributes.has("data-browsing-checking"), true);
	await flush();
	assert.deepEqual(current.navigations, ["chrome-extension://boundaries/blocked.html"]);
});

test("verified safe community becomes visible", async () => {
	const current = page({url: "https://www.reddit.com/r/example/"});
	await flush();
	assert.equal(current.attributes.has("data-browsing-checking"), false);
	assert.deepEqual(current.navigations, []);
});

test("metadata failure and malformed responses fail closed", async () => {
	for (const options of [{failed: true}, {metadata: {data: {}}}]) {
		const current = page({url: "https://www.reddit.com/r/example/", ...options});
		await flush();
		assert.deepEqual(current.navigations, ["chrome-extension://boundaries/blocked.html"]);
	}
});

test("Reddit age gates have no bypass", () => {
	const current = page({gate: true});
	assert.deepEqual(current.navigations, ["chrome-extension://boundaries/blocked.html"]);
});

test("SPA navigation redirects home and checks newly visited communities", async () => {
	const home = page();
	home.location.href = "https://www.reddit.com/?feed=home";
	home.message();
	assert.deepEqual(home.navigations, [redirects[0].to]);
	const community = page({metadata: {data: {over18: true}}});
	community.location.href = "https://www.reddit.com/r/example/";
	community.message();
	await flush();
	assert.deepEqual(community.navigations, ["chrome-extension://boundaries/blocked.html"]);
});

test("stale metadata cannot block a subsequent safe navigation", async () => {
	const current = page({url: "https://www.reddit.com/r/example/", metadata: {data: {over18: true}}});
	current.location.href = redirects[0].to;
	current.message();
	await flush();
	assert.deepEqual(current.navigations, []);
	assert.equal(current.attributes.has("data-browsing-checking"), false);
});

test("manifest exposes no action, options, or reveal controls", () => {
	const manifest = JSON.parse(source("manifest.json"));
	assert.equal(manifest.action, undefined);
	assert.equal(manifest.options_ui, undefined);
	assert.equal(manifest.options_page, undefined);
});
