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
		nodeType: 1,
		isConnected: true,
		children: [],
		getRootNode() { return document; },
		matches(selector) { return selector.includes("area[href]"); },
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
		get children() { scans++; return modal ? [modal] : targets; },
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
	for (const shortcut of ["s", "S", "j", "k", "C"]) {
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
	let keydown;
	const clicked = [];
	const rect = {top: 20, left: 20, width: 100, height: 20, right: 120, bottom: 40};
	const document = {children: [], addEventListener(type, callback) { keydown = callback; }};
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
					["button", "link"].includes(attributes.role);
				return action || (selector.includes("area[href]") &&
					(["input", "textarea", "select"].includes(localName) ||
						("tabindex" in attributes && attributes.tabindex !== "-1")));
			},
			closest() { return null; },
			hasAttribute(attribute) { return attribute in attributes; },
			getAttribute(attribute) { return attributes[attribute] ?? null; },
			getBoundingClientRect() { return rect; },
			attachShadow() { return this.shadowRoot = container({host: this}); },
			assignedNodes() { return this.assigned || []; },
			addEventListener() {},
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
	document.createElement = element;
	runInNewContext(readFileSync(join(__dirname, "src/js/content.js"), "utf8"), {
		PageNavigation: algorithms, document,
		chrome: {runtime: {getURL: path => path}},
		innerWidth: 1000, innerHeight: 1000,
		getComputedStyle: node => ({visibility: "visible", display: "block", opacity: "1", ...node.style}),
		addEventListener() {}
	});
	const overlay = document.documentElement.children[0];
	function key(key) {
		keydown({
			key, composedPath: () => [],
			preventDefault() {}, stopImmediatePropagation() {}
		});
	}
	return {
		element, document, overlay,
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
