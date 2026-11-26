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
	const page = shadowPage({deferStylesheet: true});
	const root = page.document.documentElement;
	let clicked;
	const targets = Array.from({length: 17}, (_, index) => {
		const button = page.element("button");
		button.click = () => { clicked = index; };
		return button;
	});
	root.append(...targets);
	const hints = () => page.overlay.shadowRoot.querySelectorAll(".hint");
	const editor = page.element("textarea");
	const shadowHost = page.element("custom-editor");
	const shadow = shadowHost.attachShadow();
	editor.closest = selector => selector.includes("textarea") ? editor : null;
	for (const shortcut of ["s", "S", "j", "k", "h", "l"]) {
		for (const path of [[editor, root], [editor, shadow, shadowHost, root]]) {
			const event = page.key(shortcut, "keydown", {composedPath: () => path});
			assert.equal(event.prevented, undefined);
			assert.equal(event.stopped, undefined);
		}
	}
	assert.equal(hints().length, 0);
	assert.equal(page.frames.size, 0);
	const trigger = page.key("s");
	assert.equal(trigger.prevented, true);
	assert.equal(trigger.stopped, true);
	assert.equal(page.overlay.popoverOpen, true);
	const original = hints();
	assert.equal(original.length, 17);
	assert.equal(page.overlay.style.opacity, "0");
	assert.equal(original[0].style.top, undefined);
	page.key("s");
	assert.equal(clicked, undefined);
	targets[0].rect = {...targets[0].getBoundingClientRect(), top: 10, bottom: 30};
	page.loadStylesheet();
	assert.equal(page.overlay.style.opacity, "");
	assert.equal(original[0].style.top, "11px");
	page.key("s");
	assert.equal(original.filter(node => !node.hidden).length, 2);
	assert.equal(page.key("Backspace").prevented, true);
	assert.equal(original.filter(node => !node.hidden).length, 17);
	assert.equal(clicked, undefined);
	page.key("s");
	targets[0].remove();
	targets[15].rect = {...targets[15].getBoundingClientRect(), top: -100, bottom: -80};
	root.append(...targets.slice(1).reverse());
	page.emit("scroll");
	page.advance(10);
	assert.deepEqual(hints(), original);
	assert.equal(original[15].hidden, true);
	assert.equal(original[16].hidden, false);
	assert.equal(original[16].textContent, "S");
	page.key("s");
	assert.equal(clicked, 16);
	assert.equal(hints().length, 0);
	page.key("s");
	page.emit("scroll");
	assert.equal(page.frames.size, 1);
	page.key("Escape");
	page.advance(10);
	assert.equal(hints().length, 0);
	assert.equal(page.overlay.popoverOpen, false);

	for (const target of targets) target.remove();
	root.append(editor);
	const actions = [];
	editor.focus = () => {
		assert.equal(hints().length, 0);
		actions.push("focus");
	};
	editor.click = () => actions.push("click");
	page.key("s");
	page.key("a");
	assert.deepEqual(actions, ["focus", "click"]);
	assert.equal(hints().length, 0);
});

function shadowPage({deferStylesheet = false} = {}) {
	const listeners = {};
	const frames = new Map();
	const timers = new Map();
	const movements = [];
	let now = 0;
	let callbackId = 0;
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
				const selectors = selector.split(",").map(part => part.trim());
				return selectors.includes(localName) ||
					(selectors.includes(`${localName}[href]`) && "href" in attributes) ||
					selectors.includes(`[role=${attributes.role}]`) ||
					(selectors.includes("[tabindex]:not([tabindex='-1'])") &&
						"tabindex" in attributes && attributes.tabindex !== "-1");
			},
			closest() { return null; },
			hasAttribute(attribute) { return attribute in attributes; },
			getAttribute(attribute) { return attributes[attribute] ?? null; },
			setAttribute(attribute, value) { attributes[attribute] = value; },
			removeAttribute(attribute) { delete attributes[attribute]; },
			getBoundingClientRect() { return this.rect || {...rect, top: rect.top + offset, bottom: rect.bottom + offset}; },
			attachShadow() {
				return this.shadowRoot = container({host: this, elementFromPoint(x, y) { return hitAt(this, x, y); }});
			},
			assignedNodes() { return this.assigned || []; },
			addEventListener(type, callback) { if (type === "load") stylesheetLoaded = callback; },
			showPopover() { this.popoverOpen = true; },
			hidePopover() { this.popoverOpen = false; },
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
	document.scrollingElement.scrollBy = options => movements.push(options);
	document.createElement = element;
	runInNewContext(readFileSync(join(__dirname, "src/js/content.js"), "utf8"), {
		PageNavigation: algorithms, document,
		chrome: {runtime: {getURL: path => path}},
		innerWidth: 1000, innerHeight: 1000,
		getComputedStyle(node) {
			let current = node;
			while (current && !current.style.cursor) current = current.parentElement;
			return {visibility: "visible", display: "block", opacity: "1",
				cursor: current?.style.cursor ?? "auto", ...node.style};
		},
		window: {},
		MouseEvent: class { constructor(type, options) { Object.assign(this, {type}, options); } },
		addEventListener(type, callback) { listeners[type] = callback; },
		performance: {now: () => now},
		requestAnimationFrame(callback) { frames.set(++callbackId, callback); return callbackId; },
		cancelAnimationFrame(id) { frames.delete(id); },
		setTimeout(callback, delay) {
			timers.set(++callbackId, {callback, due: now + delay});
			return callbackId;
		},
		clearTimeout(id) { timers.delete(id); }
	});
	if (!deferStylesheet) stylesheetLoaded();
	const overlay = document.documentElement.children[0];
	function key(key, type = "keydown", properties = {}) {
		const event = {
			key, composedPath: () => [],
			preventDefault() { this.prevented = true; },
			stopImmediatePropagation() { this.stopped = true; },
			...properties
		};
		listeners[type](event);
		return event;
	}
	return {
		element, document, overlay, key, movements, frames, loadStylesheet: stylesheetLoaded,
		emit(type, event = {}) { listeners[type](event); },
		advance(milliseconds, interval = 10) {
			const end = now + milliseconds;
			while (now < end) {
				now = Math.min(now + interval, end);
				for (const [id, {callback, due}] of timers) {
					if (due > now) continue;
					timers.delete(id);
					callback();
				}
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

test("generic gridcell hints activate the hit descendant without clicking an independent button", () => {
	const page = shadowPage();
	const row = page.element("div", {role: "gridcell", tabindex: "0"}, "row");
	const cell = page.element("div", {tabindex: "0", "aria-selected": "true"}, "cell");
	const title = page.element("span", {}, "chat title");
	const menu = page.element("button", {}, "row menu");
	row.rect = cell.rect = title.rect = {
		left: 20, right: 120, top: 20, bottom: 60, width: 100, height: 40
	};
	// The menu covers the first sample point but should only activate via its own hint.
	menu.rect = {...row.rect, bottom: 30, height: 10};
	cell.append(title, menu);
	row.append(cell);
	page.document.documentElement.append(row);
	assert.deepEqual(page.targets(), ["chat title", "chat title", "row menu"]);
});

test("pointer boundary merges row hints, anchors them to the wrapper and sends one mouse sequence", () => {
	const page = shadowPage();
	const row = page.element("div", {role: "gridcell", tabindex: "0"}, "row");
	const cell = page.element("div", {tabindex: "0"}, "cell");
	const wrapper = page.element("div", {}, "pointer wrapper");
	const title = page.element("span", {}, "title");
	const menu = page.element("button", {}, "menu");
	row.rect = cell.rect = {left: 20, right: 120, top: 20, bottom: 100, width: 100, height: 80};
	wrapper.rect = title.rect = {...row.rect, top: 40, height: 60};
	menu.rect = {...wrapper.rect, bottom: 50, height: 10};
	wrapper.style.cursor = "pointer";
	wrapper.append(title, menu);
	cell.append(wrapper);
	row.append(cell);
	page.document.documentElement.append(row);

	const events = [];
	wrapper.dispatchEvent = event => events.push([
		event.type, event.buttons, event.clientX, event.clientY, event.bubbles, event.detail
	]);
	page.key("s");
	const hints = page.overlay.shadowRoot.querySelectorAll(".hint");
	assert.deepEqual(hints.map(hint => [hint.textContent, hint.style.top]), [["A", "70px"], ["S", "41px"]]);
	page.key("a");
	assert.deepEqual(events, [
		["mousedown", 1, 70, 70, true, 1],
		["mouseup", 0, 70, 70, true, 1],
		["click", 0, 70, 70, true, 1]
	]);
	let menuClicks = 0;
	menu.click = () => menuClicks++;
	page.key("s");
	page.key("s");
	assert.equal(menuClicks, 1);
	assert.equal(events.length, 3);
});

test("Ctrl+S opens click hints from an editor and Escape cancels without blurring it", () => {
	const page = shadowPage();
	const editor = page.element("div", {contenteditable: "true"});
	editor.closest = selector => selector.includes("[contenteditable") ? editor : null;
	editor.blur = () => assert.fail("hint mode should not blur the editor");
	page.document.documentElement.append(page.element("button"));
	const hints = () => page.overlay.shadowRoot.querySelectorAll(".hint");
	const key = (value, properties) => page.key(value, "keydown", {
		composedPath: () => [editor, {}, page.document],
		...properties
	});
	assert.equal(key("s").prevented, undefined);
	assert.equal(key("Escape").prevented, undefined);
	assert.equal(key("s", {ctrlKey: true, isComposing: true}).prevented, undefined);
	assert.equal(key("S", {ctrlKey: true, shiftKey: true}).prevented, undefined);
	assert.equal(hints().length, 0);

	assert.equal(key("s", {ctrlKey: true}).prevented, true);
	const [hint] = hints();
	assert.equal(hint.textContent, "A");
	assert.equal(key("s", {ctrlKey: true, repeat: true}).prevented, true);
	assert.equal(hints()[0], hint);
	assert.equal(key("Escape").prevented, true);
	assert.equal(hints().length, 0);
	assert.equal(key("a").prevented, undefined);

	key("s", {ctrlKey: true});
	assert.equal(key("a").prevented, true);
	assert.equal(hints().length, 0);
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

test("shifted vertical scrolling moves about half the target height and holds at higher speed", () => {
	const page = shadowPage();
	page.key("J", "keydown", {shiftKey: true});
	page.key("j", "keyup"); // Shift was released first.
	page.advance(650);
	const distance = page.movements.reduce((sum, move) => sum + move.top, 0);
	assert.ok(Math.abs(distance - 500) < 1);
	page.key("K", "keydown", {shiftKey: true});
	page.advance(500);
	assert.ok(page.movements.at(-1).top < -41);
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
		page => page.key("c", "keydown", {ctrlKey: true}),
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
	const openScrollHints = () => page.key("c", "keydown", {ctrlKey: true});
	assert.equal(page.key("C", "keydown", {shiftKey: true}).prevented, undefined);
	assert.deepEqual(hints(), []);
	assert.equal(openScrollHints().prevented, true);
	assert.deepEqual(hints(), ["A", "S"]);
	page.key("s");
	assert.deepEqual(hints(), []);
	assert.equal(outline().length, 1);
	openScrollHints();
	page.advance(700);
	assert.deepEqual(hints(), ["A", "S"]);
	page.key("Escape");
	assert.deepEqual(hints(), []);
	assert.equal(outline().length, 0);
	page.key("J", "keydown", {shiftKey: true});
	page.key("j", "keyup");
	page.advance(650);
	const distance = nestedMovements.reduce((sum, move) => sum + move.top, 0);
	assert.ok(Math.abs(distance - 450) < 1);
	page.key("h");
	page.advance(100);
	assert.ok(nestedMovements.at(-1).left < 0);
	assert.equal(page.movements.length, 0);

	openScrollHints();
	page.key("a");
	page.key("l");
	page.advance(100);
	assert.ok(page.movements.at(-1).left > 0);
	assert.equal(outline()[0].style.width, "1000px");
	page.advance(600);
	assert.equal(outline().length, 0);
	assert.equal(page.overlay.popoverOpen, false);

	openScrollHints();
	page.key("s");
	area.isConnected = false;
	page.key("k");
	page.advance(100);
	assert.ok(page.movements.at(-1).top < 0);
});

test("Ctrl+C opens scroll hints and moves focus out of an editor without delaying scrolling", () => {
	for (const useNestedTarget of [false, true]) {
		const page = shadowPage();
		const {document} = page;
		const body = document.body = page.element("body");
		document.documentElement.append(body);
		const target = useNestedTarget ? page.element("div") : body;
		const movements = useNestedTarget ? [] : page.movements;
		const hints = () => page.overlay.shadowRoot.querySelectorAll(".hint");
		if (useNestedTarget) {
			target.style.overflowY = "auto";
			target.scrollHeight = 1000;
			target.clientHeight = 100;
			target.scrollBy = options => movements.push(options);
			body.append(target);
			page.key("c", "keydown", {ctrlKey: true});
			assert.equal(hints().length, 2);
			page.key("s");
		}
		const input = page.element("input");
		body.append(input);
		input.closest = () => input;
		document.activeElement = input;
		let onBlur;
		target.tabIndex = -1;
		target.addEventListener = (type, callback, options) => {
			assert.equal(type, "blur");
			assert.equal(options.once, true);
			onBlur = callback;
		};
		target.focus = options => {
			assert.equal(target.getAttribute("tabindex"), "-1");
			assert.equal(options.preventScroll, true);
			document.activeElement = target;
		};
		const focused = {composedPath: () => [document.activeElement, document]};
		assert.equal(page.key("c", "keydown", {ctrlKey: true, ...focused}).prevented, true);
		assert.equal(document.activeElement, target);
		assert.equal(hints().length, useNestedTarget ? 2 : 1);
		assert.equal(page.key("j", "keydown", focused).prevented, true);
		assert.equal(hints().length, 0);
		page.advance(100);
		assert.ok(movements.at(-1).top > 0);
		document.activeElement = input;
		onBlur();
		assert.equal(target.hasAttribute("tabindex"), false);
		assert.equal(page.key("j", "keydown", focused).prevented, undefined);

		page.key("c", "keydown", {ctrlKey: true, ...focused});
		// If the page takes focus back, selecting a hint moves it again.
		document.activeElement = input;
		onBlur();
		page.key(useNestedTarget ? "s" : "a", "keydown", focused);
		assert.equal(document.activeElement, target);
		assert.equal(hints().length, 0);
	}
});
