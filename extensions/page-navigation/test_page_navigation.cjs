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
	let overlay;
	const shadow = {
		append(node) { nodes.push(node); },
		querySelectorAll() { return nodes.filter(node => node.className === "hint"); }
	};
	const rect = {top: 20, left: 20, width: 100, height: 20, right: 120, bottom: 40};
	const targets = Array.from({length: 17}, (_, index) => ({
		nodeType: 1,
		isConnected: true,
		children: [],
		getRootNode() { return document; },
		matches(selector) { return selector.includes("area[href]"); },
		hasAttribute() { return false; },
		getAttribute() { return null; },
		closest() { return null; },
		getBoundingClientRect() {
			return this.rect || {...rect, top: rect.top + index * 24, bottom: rect.bottom + index * 24};
		},
		click() { clicked = index; }
	}));
	const document = {
		documentElement: {append() {}},
		elementFromPoint(x, y) {
			return targets.find(target => {
				const {left, right, top, bottom} = target.getBoundingClientRect();
				return x >= left && x < right && y >= top && y < bottom;
			});
		},
		createElement() {
			return {
				style: {}, offsetWidth: 20, offsetHeight: 16,
				attachShadow() { return shadow; },
				showPopover() { overlayOpen = true; overlay = this; },
				hidePopover() { overlayOpen = false; },
				addEventListener(type, callback) { stylesheetLoaded = callback; },
				remove() { nodes.splice(nodes.indexOf(this), 1); }
			};
		},
		get children() { scans++; return modal ? [modal] : targets; },
		addEventListener(type, callback) { if (type === "keydown") keydown = callback; }
	};
	runInNewContext(readFileSync(join(__dirname, "src/js/content.js"), "utf8"), {
		PageNavigation: algorithms, document,
		chrome: {runtime: {getURL: path => path}},
		innerWidth: 1000, innerHeight: 1000,
		getComputedStyle: () => ({visibility: "visible", display: "block", opacity: "1"}),
		addEventListener(type, callback) { listeners[type] = callback; },
		requestAnimationFrame(callback) { frames.push(callback); }
	});
	let prevented = 0;
	let stopped = 0;
	const key = (key, target = {closest() { return null; }}, path = [target]) => keydown({
		key, target, shiftKey: key === "C",
		composedPath() { return path; },
		preventDefault() { prevented++; },
		stopImmediatePropagation() { stopped++; }
	});
	const hints = () => nodes.filter(node => node.className === "hint");
	const input = {
		closest(selector) { return selector.includes("input") ? this : null; }
	};
	const shadowHost = {closest() { return null; }};
	for (const shortcut of ["s", "S", "j", "k", "h", "l", "C"]) {
		key(shortcut, input);
		key(shortcut, shadowHost, [input, {}, shadowHost, document]);
	}
	assert.equal(scans, 0);
	assert.equal(hints().length, 0);
	assert.equal(prevented, 0);
	assert.equal(stopped, 0);
	key("s");
	assert.equal(overlayOpen, true);
	assert.equal(prevented, 1);
	assert.equal(stopped, 1);
	const original = hints();
	assert.equal(overlay.style.opacity, "0");
	assert.equal(original[0].style.top, undefined);
	key("s");
	assert.equal(clicked, undefined);
	targets[0].rect = {...rect, top: 10, bottom: 30};
	stylesheetLoaded();
	assert.equal(overlay.style.opacity, "");
	assert.equal(original[0].style.top, "11px");
	key("s");
	assert.equal(original.filter(node => !node.hidden).length, 2);
	targets[0].isConnected = false;
	targets[15].rect = {...rect, top: -100, bottom: -80};
	targets.reverse();
	listeners.scroll();
	frames.shift()();
	listeners.resize();
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
		nodeType: 1,
		matches(selector) { return selector === ":modal"; },
		getRootNode() { return document; },
		getBoundingClientRect() { return rect; },
		append(node) { overlayParent = node; },
		get children() { modalScans++; return [targets[0]]; }
	};
	key("s");
	assert.equal(modalScans, 2);
	assert.equal(scans, 4);
	assert.equal(overlayParent.id, "page-navigation-host");
	assert.equal(overlayOpen, true);
	key("Escape");
	assert.equal(overlayOpen, false);
});

function shadowPage() {
	const listeners = {};
	const frames = new Map();
	const movements = [];
	let now = 0;
	let frameId = 0;
	let stylesheetLoaded;
	let elementIndex = 0;
	const clicked = [];
	const rect = {top: 20, left: 20, width: 100, height: 20, right: 120, bottom: 40};
	const document = {
		children: [],
		elementFromPoint(x, y) { return hitAt(this, x, y); },
		addEventListener(type, callback) { listeners[type] = callback; }
	};
	function hitAt(root, x, y) {
		if (root.style?.overflow === "hidden") {
			const {left, right, top, bottom} = root.getBoundingClientRect();
			if (x < left || x >= right || y < top || y >= bottom) return;
		}
		const children = root.assigned?.length ? root.assigned : root.children;
		for (const node of [...children].reverse()) {
			if (node.id === "page-navigation-host" || !node.isConnected || node.style.display === "none") continue;
			const hit = hitAt(node.shadowRoot || node, x, y);
			if (hit) return node.shadowRoot ? node : hit;
			const {left, right, top, bottom} = node.getBoundingClientRect();
			if (x >= left && x < right && y >= top && y < bottom) return node;
		}
	}
	function container(properties = {}) {
		return Object.defineProperties({
			children: [],
			append(...nodes) {
				for (const node of nodes) {
					node.remove?.();
					this.children.push(node);
					node.parentNode = this;
				}
			},
			querySelectorAll(selector) {
				return this.children.filter(node => selector.split(", ")
					.some(part => part === `.${node.className}`));
			}
		}, Object.getOwnPropertyDescriptors(properties));
	}
	function element(localName, attributes = {}, name = localName) {
		const offset = elementIndex++ * 24;
		return container({
			nodeType: 1, localName, attributes, style: {},
			isConnected: true, offsetWidth: 20, offsetHeight: 16,
			get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; },
			getRootNode() {
				let root = this;
				while (root.parentNode) root = root.parentNode;
				return root;
			},
			matches(selector) {
				if (selector === ":modal") return !!this.nativeModal;
				if (selector === '[aria-modal="true"]') return attributes["aria-modal"] === "true";
				if (selector === "[inert], [aria-hidden='true']") {
					return "inert" in attributes || attributes["aria-hidden"] === "true";
				}
				const action = localName === "button" || (localName === "a" && "href" in attributes) ||
					("role" in attributes && selector.includes(`[role=${attributes.role}]`));
				return action || (selector.includes("area[href]") &&
					(["input", "textarea", "select"].includes(localName) ||
						("tabindex" in attributes && attributes.tabindex !== "-1")));
			},
			closest() { return null; },
			hasAttribute(attribute) { return attribute in attributes; },
			getAttribute(attribute) { return attributes[attribute] ?? null; },
			getBoundingClientRect() { return this.rect || {...rect, top: rect.top + offset, bottom: rect.bottom + offset}; },
			attachShadow() {
				return this.shadowRoot = container({host: this, elementFromPoint(x, y) { return hitAt(this, x, y); }});
			},
			assignedNodes() { return this.assigned || []; },
			addEventListener(type, callback) { if (type === "load") stylesheetLoaded = callback; },
			showPopover() {},
			hidePopover() {},
			click() { clicked.push(name); },
			remove() {
				if (!this.parentNode) return;
				const siblings = this.parentNode.children;
				siblings.splice(siblings.indexOf(this), 1);
				this.parentNode = null;
			}
		});
	}
	document.documentElement = element("html");
	document.children.push(document.documentElement);
	document.documentElement.parentNode = document;
	document.scrollingElement = document.documentElement;
	document.scrollingElement.scrollBy = options => movements.push({...options, time: now});
	document.createElement = element;
	runInNewContext(readFileSync(join(__dirname, "src/js/content.js"), "utf8"), {
		PageNavigation: algorithms, document,
		chrome: {runtime: {getURL: path => path}},
		innerWidth: 1000, innerHeight: 1000,
		getComputedStyle: node => ({visibility: "visible", display: "block", opacity: "1", ...node.style}),
		addEventListener(type, callback) { listeners[type] = callback; },
		performance: {now: () => now},
		requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
		cancelAnimationFrame(id) { frames.delete(id); },
		setTimeout() { return 1; },
		clearTimeout() {}
	});
	stylesheetLoaded();
	const overlay = document.documentElement.children[0];
	function key(key, type = "keydown", properties = {}) {
		const event = {
			key, shiftKey: key === "C", composedPath: () => [],
			preventDefault() { this.prevented = true; },
			stopImmediatePropagation() {},
			...properties
		};
		listeners[type](event);
		return event;
	}
	return {
		element, document, overlay, key, movements, frames,
		emit(type, event = {}) { listeners[type](event); },
		advance(milliseconds, interval = 10) {
			const end = now + milliseconds;
			while (now < end) {
				now = Math.min(now + interval, end);
				const pending = [...frames.values()];
				frames.clear();
				for (const callback of pending) callback(now);
			}
		},
		targets() {
			clicked.length = 0;
			key("s");
			const labels = overlay.shadowRoot.querySelectorAll(".hint").map(node => node.textContent);
			key("Escape");
			for (const label of labels) {
				key("s");
				for (const letter of label) key(letter.toLowerCase());
			}
			return [...clicked];
		}
	};
}

test("click hints include roving-tabindex ARIA controls and their independent buttons", () => {
	const page = shadowPage();
	const tree = page.element("div", {role: "tree"});
	const chat = page.element("div", {role: "treeitem", tabindex: "-1"}, "chat");
	chat.append(page.element("span", {role: "text"}), page.element("button", {}, "overflow"));
	tree.append(chat, page.element("div", {role: "treeitem", tabindex: "-1", "aria-disabled": "true"}));
	const roles = ["tab", "option", "menuitem", "menuitemcheckbox", "menuitemradio"];
	page.document.documentElement.append(tree, ...roles.map(role =>
		page.element("div", {role, tabindex: "-1"}, role)
	));
	assert.deepEqual(page.targets(), ["chat", "overflow", ...roles]);
});

test("hint placement reuses discovery hits and batches viewport updates", () => {
	const page = shadowPage();
	page.document.documentElement.append(page.element("button"), page.element("button"));
	const hit = page.document.elementFromPoint.bind(page.document);
	let hitCount = 0;
	page.document.elementFromPoint = (x, y) => {
		hitCount++;
		return hit(x, y);
	};
	page.key("s");
	assert.equal(hitCount, 2);
	const operations = [];
	for (const hint of page.overlay.shadowRoot.querySelectorAll(".hint")) {
		const text = hint.textContent;
		Object.defineProperty(hint, "textContent", {
			get: () => text,
			set: () => operations.push("text write")
		});
		Object.defineProperty(hint, "offsetWidth", {
			get() { operations.push("measure"); return 20; }
		});
		Object.defineProperty(hint.style, "top", {set: () => operations.push("position write")});
	}
	page.emit("scroll");
	page.emit("resize");
	page.emit("scroll");
	assert.equal(page.frames.size, 1);
	assert.equal(hitCount, 2);
	page.advance(10);
	assert.equal(hitCount, 4);
	assert.deepEqual(operations, ["measure", "measure", "position write", "position write"]);
});

test("hints skip clipped and covered rows and keep their labels as exposure changes", () => {
	const page = shadowPage();
	const bounds = (top, bottom) => ({top, bottom, height: bottom - top, left: 10, right: 110, width: 100});
	const panel = page.element("div");
	panel.rect = bounds(20, 100);
	panel.style.overflow = "hidden";
	const [covered, partial, clipped] = ["covered", "partial", "clipped"].map(name =>
		page.element("div", {role: "treeitem", tabindex: "-1"}, name)
	);
	covered.rect = bounds(40, 60);
	partial.rect = bounds(80, 110);
	clipped.rect = bounds(110, 135);
	panel.append(covered, partial, clipped);
	const cover = page.element("div");
	cover.rect = bounds(35, 94);
	page.document.documentElement.append(panel, cover);
	assert.deepEqual(page.targets(), ["partial"]);

	page.key("s");
	const [hint] = page.overlay.shadowRoot.querySelectorAll(".hint");
	assert.equal(hint.style.top, "95px");
	cover.rect = bounds(35, 100);
	page.emit("scroll");
	page.advance(10);
	assert.equal(hint.hidden, true);
	cover.rect = bounds(35, 94);
	page.emit("scroll");
	page.advance(10);
	assert.equal(hint.hidden, false);
	assert.equal(hint.textContent, "A");
	partial.click = () => assert.fail("a newly covered target must not activate");
	cover.rect = bounds(35, 100);
	page.key("a");
});

test("hints enter open shadow roots and deduplicate slotted controls", () => {
	const page = shadowPage();
	const post = page.element("shreddit-post");
	const root = post.attachShadow();
	const upvote = page.element("button", {}, "upvote");
	const comment = page.element("button", {}, "comment");
	const linkHost = page.element("auth-flow-link");
	const link = page.element("a", {href: "#"}, "email");
	const slot = page.element("slot");
	const visualButton = page.element("span", {role: "button"}, "duplicate");
	linkHost.append(visualButton, page.element("button", {}, "unassigned"));
	linkHost.attachShadow().append(link);
	link.append(slot);
	slot.assigned = [visualButton];
	visualButton.assignedSlot = slot;
	root.append(upvote, comment, linkHost);
	page.document.documentElement.append(post);
	assert.deepEqual(page.targets(), ["upvote", "comment", "email"]);
});

test("slots hint fallback controls only when no content is assigned", () => {
	const page = shadowPage();
	const component = page.element("custom-control");
	const slot = page.element("slot");
	slot.append(page.element("button", {}, "fallback"));
	component.attachShadow().append(slot);
	page.document.documentElement.append(component);
	assert.deepEqual(page.targets(), ["fallback"]);
	slot.assigned = [{nodeType: 3}];
	assert.deepEqual(page.targets(), []);
});

test("visible shadow modals include slotted controls and exclude background and hidden dialogs", () => {
	const page = shadowPage();
	const background = page.element("button", {}, "background");
	const manager = page.element("auth-flow-modal");
	const dialog = page.element("div", {role: "dialog", "aria-modal": "true"});
	const slot = page.element("slot");
	const phone = page.element("auth-flow-link");
	const phoneLink = page.element("a", {href: "#"}, "phone");
	phone.attachShadow().append(phoneLink);
	const close = page.element("button", {}, "close");
	manager.append(phone, close);
	slot.assigned = [phone, close];
	phone.assignedSlot = close.assignedSlot = slot;
	dialog.append(slot);
	manager.attachShadow().append(dialog);
	const hiddenPanel = page.element("otp-panel");
	const hiddenDialog = page.element("div", {role: "dialog", "aria-modal": "true"});
	hiddenDialog.append(page.element("button", {}, "OTP"));
	hiddenPanel.attachShadow().append(hiddenDialog);
	hiddenPanel.style.display = "none";
	page.document.documentElement.append(background, manager, hiddenPanel);
	assert.deepEqual(page.targets(), ["phone", "close"]);
	assert.equal(page.overlay.parentElement, dialog);
	phone.attributes["aria-hidden"] = "true";
	assert.deepEqual(page.targets(), ["close"]);
	delete phone.attributes["aria-hidden"];
	phoneLink.attributes["aria-disabled"] = "true";
	assert.deepEqual(page.targets(), ["close"]);
	delete phoneLink.attributes["aria-disabled"];
	manager.style.display = "none";
	assert.deepEqual(page.targets(), ["background"]);
});

test("native shadow modals take precedence and composed ancestors block hidden controls", () => {
	const page = shadowPage();
	const custom = page.element("div", {"aria-modal": "true"});
	custom.append(page.element("button", {}, "background dialog"));
	const component = page.element("custom-dialog");
	const native = page.element("dialog");
	native.nativeModal = true;
	native.append(page.element("button", {}, "native"));
	const blocked = page.element("custom-control", {inert: ""});
	blocked.attachShadow().append(page.element("button", {}, "inert"));
	const transparent = page.element("custom-control");
	transparent.style.opacity = "0";
	transparent.attachShadow().append(page.element("button", {}, "transparent"));
	native.append(blocked, transparent);
	component.attachShadow().append(native);
	page.document.documentElement.append(component, custom);
	assert.deepEqual(page.targets(), ["native"]);
	assert.equal(page.overlay.parentElement, native);
});

test("scroll taps are larger eased motions with the same release curve as holds", () => {
	const page = shadowPage();
	page.key("j");
	page.key("j", "keyup");
	assert.equal(page.movements.length, 0);
	page.advance(600);
	const distances = page.movements.map(move => move.top);
	const total = distances.reduce((sum, distance) => sum + distance, 0);
	assert.ok(total > 105 && total < 110, `tap distance: ${total}`);
	assert.ok(distances[0] < distances[1]);
	assert.ok(distances.at(-1) < distances.at(-2));
	assert.ok(page.movements.every(move => move.behavior === "instant"));
	assert.equal(page.frames.size, 0);

	page.key("k");
	page.advance(600);
	const beforeRelease = page.movements.at(-1).top;
	assert.ok(Math.abs(beforeRelease + 9) < 0.01);
	page.key("K", "keyup");
	page.advance(10);
	assert.ok(page.movements.at(-1).top > beforeRelease);
	assert.ok(page.movements.at(-1).top < 0);
	page.advance(500);
	assert.equal(page.frames.size, 0);
});

test("held scrolling is frame-rate independent and ignores keyboard repeat", () => {
	function hold(interval, repeat) {
		const page = shadowPage();
		page.key("j");
		for (let elapsed = 0; elapsed < 1000; elapsed += 20) {
			if (repeat) page.key("j", "keydown", {repeat: true});
			assert.equal(page.frames.size, 1);
			page.advance(20, interval);
		}
		const distance = page.movements.reduce((sum, move) => sum + move.top, 0);
		assert.ok(distance > 850 && distance < 860);
		page.key("j", "keyup");
		page.advance(500, interval);
		assert.equal(page.frames.size, 0);
		return page.movements.reduce((sum, move) => sum + move.top, 0);
	}
	assert.ok(Math.abs(hold(5, false) - hold(20, true)) < 0.1);
});

test("horizontal scrolling matches vertical easing for taps and holds", () => {
	function movements(key, axis, heldMs) {
		const page = shadowPage();
		page.key(key);
		page.advance(heldMs);
		page.key(key, "keyup");
		page.advance(600);
		assert.equal(page.frames.size, 0);
		const otherAxis = axis === "top" ? "left" : "top";
		assert.ok(page.movements.every(move => axis in move && !(otherAxis in move)));
		return page.movements.map(move => move[axis]);
	}
	assert.deepEqual(movements("l", "left", 0), movements("j", "top", 0));
	assert.deepEqual(movements("h", "left", 400), movements("k", "top", 400));
});

test("shifted vertical scrolling moves about a third of the target height and holds at higher speed", () => {
	const page = shadowPage();
	page.key("J", "keydown", {shiftKey: true});
	page.key("j", "keyup"); // Shift was released first.
	page.advance(650);
	const distance = page.movements.reduce((sum, move) => sum + move.top, 0);
	assert.ok(Math.abs(distance - 1000 / 3) < 1);
	page.key("K", "keydown", {shiftKey: true});
	page.advance(500);
	assert.ok(page.movements.at(-1).top < -27);
	page.key("K", "keyup", {shiftKey: true});
	page.advance(650);
	assert.equal(page.frames.size, 0);
});

test("direction changes and a new press during deceleration preserve velocity", () => {
	const page = shadowPage();
	page.key("j");
	page.advance(400);
	page.key("k");
	page.key("j", "keyup");
	page.advance(10);
	assert.ok(page.movements.at(-1).top > 0, "reversal should not jump to full reverse speed");
	page.advance(400);
	assert.ok(page.movements.at(-1).top < -8.9);
	page.key("k", "keyup");
	page.advance(30);
	page.key("k");
	page.advance(10);
	const resumed = page.movements.at(-1).top;
	assert.ok(resumed < -4 && resumed > -8, "a fresh press should preserve the remaining velocity");
	page.advance(20);
	assert.ok(page.movements.at(-1).top < resumed, "a fresh press should smoothly regain speed");
	page.key("k", "keyup");
	page.advance(600);
	assert.equal(page.frames.size, 0);
});

test("scrolling stops on lost focus, hidden pages, editable focus, hints, or target removal", () => {
	for (const interrupt of [
		page => page.emit("blur"),
		page => page.emit("pagehide"),
		page => { page.document.hidden = true; page.emit("visibilitychange"); },
		page => page.emit("focusin", {composedPath: () => [{closest: () => true}]}),
		page => page.key("s"),
		page => page.key("C"),
		page => { page.document.scrollingElement.isConnected = false; page.advance(10); }
	]) {
		const page = shadowPage();
		page.key("j");
		page.advance(200);
		interrupt(page);
		const count = page.movements.length;
		page.advance(500);
		assert.equal(page.movements.length, count);
		assert.equal(page.frames.size, 0);
	}
	const page = shadowPage();
	page.key("j", "keydown", {composedPath: () => [{closest: () => true}]});
	assert.equal(page.frames.size, 0);
});

test("scroll hints select without clicking, cancel without changing selection, and include the page", () => {
	const page = shadowPage();
	const host = page.element("scroll-area");
	const area = page.element("button");
	area.style.overflowY = "auto";
	area.style.overflowX = "auto";
	area.scrollHeight = 2000;
	area.clientHeight = 900;
	area.scrollWidth = 500;
	area.clientWidth = 100;
	area.click = () => assert.fail("a scroll hint must not click its target");
	const nestedMovements = [];
	area.scrollBy = options => nestedMovements.push(options);
	host.attachShadow().append(area);
	page.document.documentElement.append(host);
	const hints = () => page.overlay.shadowRoot.querySelectorAll(".hint").map(hint => hint.textContent);
	const outline = () => page.overlay.shadowRoot.querySelectorAll(".scroll-target");
	page.key("C");
	assert.deepEqual(hints(), ["A", "S"]);
	page.key("s");
	assert.deepEqual(hints(), []);
	assert.equal(outline().length, 1);
	page.key("C");
	page.key("Escape");
	assert.deepEqual(hints(), []);
	assert.equal(outline().length, 0);
	page.key("J", "keydown", {shiftKey: true});
	page.key("j", "keyup");
	page.advance(650);
	const distance = nestedMovements.reduce((sum, move) => sum + move.top, 0);
	assert.ok(Math.abs(distance - 300) < 1);
	page.key("h");
	page.advance(100);
	assert.ok(nestedMovements.at(-1).left < 0);
	assert.equal(page.movements.length, 0);

	page.key("C");
	page.key("a");
	page.key("l");
	page.advance(100);
	assert.ok(page.movements.at(-1).left > 0);
	assert.equal(outline()[0].style.width, "1000px");

	page.key("C");
	page.key("s");
	area.isConnected = false;
	page.key("k");
	page.advance(100);
	assert.ok(page.movements.at(-1).top < 0);
});
