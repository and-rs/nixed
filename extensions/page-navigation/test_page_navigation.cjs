const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {runInNewContext} = require("node:vm");
const test = require("node:test");

const algorithms = runInNewContext(readFileSync(
	join(__dirname, "src/js/algorithms.js"), "utf8"
) + "\nPageNavigation;");

test("manifest injects page navigation separately", () => {
	const root = join(__dirname, "src");
	const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
	assert.deepEqual(manifest.content_scripts[0].matches, ["<all_urls>"]);
	assert.deepEqual(manifest.content_scripts[0].js, ["js/algorithms.js", "js/content.js"]);
});

test("hint labels are unique fixed-width prefixes for any candidate count", () => {
	for (const count of [1, 15, 16, 200, 3000]) {
		const labels = algorithms.labelsFor(count);
		assert.equal(labels.length, count);
		assert.equal(new Set(labels).size, count);
		assert.equal(new Set(labels.map(label => label.length)).size, 1);
	}
});

test("scroll target cycling follows the current target and recovers if it disappears", () => {
	const page = {};
	const first = {};
	const second = {};
	let next = algorithms.nextScrollTarget([page, first, second], page);
	assert.equal(next.target, first);
	assert.equal(next.index, 1);
	next = algorithms.nextScrollTarget([page, second], first);
	assert.equal(next.target, page);
	assert.equal(next.index, 0);
	next = algorithms.nextScrollTarget([], page);
	assert.equal(next.target, undefined);
	assert.equal(next.index, 0);
});

test("hint sessions keep stable targets and focus editable selections", () => {
	const nodes = [];
	const listeners = {};
	const frames = [];
	let keydown;
	let stylesheetLoaded;
	let clicked;
	let scans = 0;
	let modal;
	let overlayOpen = false;
	const shadow = {
		append(node) { nodes.push(node); },
		querySelectorAll() { return nodes.filter(node => node.className === "hint"); }
	};
	const rect = {top: 20, left: 20, width: 100, height: 20, right: 120, bottom: 40};
	const targets = Array.from({length: 17}, (_, index) => ({
		isConnected: true,
		hasAttribute() { return false; },
		getAttribute() { return null; },
		closest() { return null; },
		getBoundingClientRect() { return this.rect || rect; },
		click() { clicked = index; }
	}));
	const document = {
		documentElement: {append() {}},
		createElement() {
			return {
				style: {}, offsetWidth: 20, offsetHeight: 16,
				attachShadow() { return shadow; },
				showPopover() { overlayOpen = true; },
				hidePopover() { overlayOpen = false; },
				addEventListener(type, callback) { stylesheetLoaded = callback; },
				remove() { nodes.splice(nodes.indexOf(this), 1); }
			};
		},
		querySelectorAll() { scans++; return targets; },
		querySelector() { return modal; },
		addEventListener(type, callback) { keydown = callback; }
	};
	runInNewContext(readFileSync(join(__dirname, "src/js/content.js"), "utf8"), {
		PageNavigation: algorithms, document,
		chrome: {runtime: {getURL: path => path}},
		innerWidth: 1000, innerHeight: 1000,
		getComputedStyle: () => ({visibility: "visible", display: "block", opacity: "1"}),
		addEventListener(type, callback) { listeners[type] = callback; },
		requestAnimationFrame(callback) { frames.push(callback); }
	});
	const key = (key, target = {closest() { return null; }}) => keydown({
		key, target,
		preventDefault() {}, stopImmediatePropagation() {}
	});
	const hints = () => nodes.filter(node => node.className === "hint");
	key("s");
	assert.equal(overlayOpen, true);
	const original = hints();
	key("s");
	assert.equal(original.filter(node => !node.hidden).length, 2);
	targets[0].isConnected = false;
	targets[15].rect = {...rect, top: -100, bottom: -80};
	targets.reverse();
	listeners.scroll();
	frames.shift()();
	listeners.resize();
	stylesheetLoaded();
	assert.equal(scans, 1);
	assert.deepEqual(hints(), original);
	assert.equal(original[15].hidden, true);
	assert.equal(original[16].hidden, false);
	assert.equal(original[16].textContent, "S");
	key("s");
	assert.equal(clicked, 16);
	assert.equal(hints().length, 0);
	key("s");
	listeners.scroll();
	key("Escape");
	frames.shift()();
	assert.equal(hints().length, 0);
	assert.equal(scans, 2);

	let focused = false;
	const editor = {
		...targets[0],
		isConnected: true,
		closest(selector) { return selector.includes("textarea") ? this : null; },
		focus() {
			assert.equal(hints().length, 0);
			focused = true;
		},
		click() { assert.equal(focused, true); }
	};
	targets.splice(0, targets.length, editor);
	key("s");
	key("a");
	assert.equal(focused, true);
	assert.equal(hints().length, 0);
	key("s", editor);
	assert.equal(hints().length, 0);
	assert.equal(scans, 3);

	let modalScans = 0;
	let overlayParent;
	modal = {
		append(node) { overlayParent = node; },
		querySelectorAll() { modalScans++; return [targets[0]]; }
	};
	key("s");
	assert.equal(modalScans, 1);
	assert.equal(scans, 3);
	assert.equal(overlayParent.id, "page-navigation-host");
	assert.equal(overlayOpen, true);
	key("Escape");
	assert.equal(overlayOpen, false);
});
