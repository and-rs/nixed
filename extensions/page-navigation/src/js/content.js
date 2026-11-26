(() => {
	const {alphabet, labelsFor} = PageNavigation;
	const editableSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
	const actionSelector = [
		"a[href]", "area[href]", "button", editableSelector,
		"[role=button]", "[role=link]", "[role=treeitem]", "[role=tab]", "[role=option]",
		"[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]"
	].join(",");
	const hintSelector = `${actionSelector},[tabindex]:not([tabindex='-1'])`;
	const independentSelector = `${actionSelector},label,summary`;
	const scrollSpeed = 900;
	const scrollEaseMs = 50;
	const scrollTapMs = 120;
	const host = document.createElement("div");
	host.id = "page-navigation-host";
	host.popover = "manual";
	host.style.cssText = "position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;pointer-events:none";
	const shadow = host.attachShadow({mode: "open"});
	const stylesheet = document.createElement("link");
	stylesheet.rel = "stylesheet";
	stylesheet.href = chrome.runtime.getURL("css/page-navigation.css");
	let stylesheetReady = false;
	stylesheet.addEventListener("load", () => {
		stylesheetReady = true;
		positionHints();
	});
	shadow.append(stylesheet);
	(document.documentElement || document).append(host);

	let hints = [];
	let hintPrefix = "";
	let hintFramePending = false;
	let scrollHints = false;
	let scrollTarget;
	let scrollOutlineTimer;
	let scrollMotion;
	let scrollFrame;

	function editable(element) {
		return element?.closest?.(editableSelector);
	}

	function parent(element) {
		return element.assignedSlot || element.parentElement || element.getRootNode()?.host;
	}

	function* ancestors(element) {
		for (let current = element; current; current = parent(current)) yield current;
	}

	function* renderedElements(root) {
		if (root === host) return;
		if (root.matches) yield root;
		const assigned = root.localName === "slot" ? root.assignedNodes({flatten: true}) : [];
		const children = assigned.length ? assigned : (root.shadowRoot || root).children;
		for (const child of children) {
			if (child.nodeType === 1) yield* renderedElements(child);
		}
	}

	function visible(element, rect = element.getBoundingClientRect()) {
		if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 ||
			rect.top >= innerHeight || rect.left >= innerWidth) return false;
		return [...ancestors(element)].every(ancestor => {
			const style = getComputedStyle(ancestor);
			return (ancestor !== element || style.visibility !== "hidden") &&
				style.display !== "none" && Number(style.opacity) > 0 &&
				!ancestor.matches("[inert], [aria-hidden='true']");
		});
	}

	function exposedPoint(element, activateDescendant = false, resolveWrapper) {
		if (!element.isConnected) return;
		const rect = element.getBoundingClientRect();
		if (!visible(element, rect)) return;
		const left = Math.max(0, rect.left);
		const top = Math.max(0, rect.top);
		const right = Math.min(innerWidth, rect.right);
		const bottom = Math.min(innerHeight, rect.bottom);
		const midX = (left + right) / 2;
		const midY = (top + bottom) / 2;
		const insetX = Math.min(1, (right - left) / 4);
		const insetY = Math.min(1, (bottom - top) / 4);
		let fallback;

		// Hit testing accounts for both overflow clipping and content painted on top.
		for (const y of [top + insetY, midY, bottom - insetY]) {
			for (const x of [midX, left + insetX, right - insetX]) {
				let hit = document.elementFromPoint(x, y);
				while (hit?.shadowRoot) {
					const inner = hit.shadowRoot.elementFromPoint(x, y);
					if (!inner || inner === hit) break;
					hit = inner;
				}
				let target;
				let blocked = false;
				for (const ancestor of ancestors(hit)) {
					if (ancestor === element) {
						const point = {x, y, target: blocked ? element : target || element, blocked};
						if (!blocked) {
							if (!resolveWrapper) return point;
							const wrapper = resolveWrapper(point.target);
							if (wrapper) return {...point, wrapper};
						}
						if (!fallback || (fallback.blocked && !blocked)) fallback = point;
						break;
					}
					if (!activateDescendant) continue;
					// A wrapper's hint must not activate a separate control inside it.
					if (ancestor.matches(independentSelector)) blocked = true;
					if (!target && typeof ancestor.click === "function") target = ancestor;
				}
			}
		}
		return fallback;
	}

	function activeModal(elements) {
		const native = elements.findLast(element => element.matches(":modal") && visible(element));
		return elements.findLast(element =>
			element.matches('[aria-modal="true"]') && visible(element) &&
			(!native || [...ancestors(element)].includes(native))
		) || native;
	}

	function clickable(element) {
		return !element.disabled && !element.readOnly && !element.hasAttribute("disabled") &&
			element.getAttribute("aria-disabled") !== "true";
	}

	function pointerWrapper(hit, modal) {
		for (const element of ancestors(hit)) {
			if (element === modal || element === document.body || element === document.documentElement ||
				element.matches(independentSelector) || !clickable(element) ||
				getComputedStyle(element).cursor !== "pointer") return;
			const outer = parent(element);
			if (!outer || getComputedStyle(outer).cursor !== "pointer") return element;
		}
	}

	function candidates(elements, forScroll, modal) {
		const targets = new Map();
		const resolveWrapper = hit => pointerWrapper(hit, modal);
		for (const element of elements) {
			if (!(forScroll ? scrollable(element) : element.matches(hintSelector) && clickable(element))) continue;
			const generic = !forScroll && !element.matches(independentSelector);
			const point = exposedPoint(element, generic, generic ? resolveWrapper : undefined);
			if (!point) continue;
			const {wrapper} = point;
			if (wrapper) {
				if (targets.get(wrapper)?.press) continue;
				const wrapperPoint = wrapper === element ? point : exposedPoint(wrapper, true);
				if (wrapperPoint && !wrapperPoint.blocked) {
					targets.set(wrapper, {element: wrapper, point: wrapperPoint, press: true});
					continue;
				}
			}
			if (!targets.has(element)) targets.set(element, {element, point});
		}
		if (forScroll) return [...targets.values()];
		return [...targets.values()].filter(({element}) => {
			for (const ancestor of ancestors(element)) {
				if (ancestor !== element && targets.has(ancestor) &&
					ancestor.matches("a[href],button,[role=button],[role=link]")) {
					return false;
				}
			}
			return true;
		});
	}

	function clearOverlay() {
		hints = [];
		hintPrefix = "";
		clearTimeout(scrollOutlineTimer);
		scrollOutlineTimer = undefined;
		shadow.querySelectorAll(".hint, .scroll-target").forEach(element => element.remove());
		host.hidePopover();
	}

	function showHints(forScroll = false) {
		stopScroll();
		clearOverlay();
		const rendered = [...renderedElements(document)];
		const modal = activeModal(rendered);
		const scope = modal ? [...renderedElements(modal)] : rendered;
		const targets = candidates(scope, forScroll, modal);
		scrollHints = forScroll;
		const root = document.scrollingElement;
		if (forScroll && !modal && root) targets.unshift({element: root, point: hintPoint(root)});
		if (!targets.length) return;
		const labels = labelsFor(targets.length);
		hints = targets.map(({element, press}, index) => ({
			element,
			press,
			label: labels[index],
			node: document.createElement("span")
		}));
		for (const hint of hints) {
			hint.node.className = "hint";
			shadow.append(hint.node);
		}
		const container = modal || document.documentElement;
		if (host.parentElement !== container) container.append(host);
		host.style.opacity = "0";
		host.showPopover();
		if (stylesheetReady) positionHints(targets.map(({point}) => point));
	}

	function positionHints(initialPoints) {
		if (!stylesheetReady || !hints.length) return;
		const points = initialPoints ?? hints.map(({element, label, press}) =>
			label.startsWith(hintPrefix) && hintPoint(element, press));
		for (const [index, {node, label}] of hints.entries()) {
			const hidden = !points[index];
			if (node.hidden !== hidden) node.hidden = hidden;
			if (hidden) continue;
			const text = label.slice(hintPrefix.length);
			if (node.textContent !== text) node.textContent = text;
		}
		const placed = [];
		for (const [index, {node}] of hints.entries()) {
			const point = points[index];
			if (!point) continue;
			const {offsetWidth: width, offsetHeight: height} = node;
			const left = Math.max(0, Math.min(
				point.x - width / 2,
				innerWidth - width
			));
			let top = Math.max(0, Math.min(point.y, innerHeight - height));
			while (placed.some(other => left < other.right && left + width > other.left &&
				top < other.bottom && top + height > other.top) &&
				top + 2 * height + 2 <= innerHeight) {
				top += height + 2;
			}
			placed.push({node, left, top, right: left + width, bottom: top + height});
		}
		for (const {node, top, left} of placed) {
			node.style.top = `${top}px`;
			node.style.left = `${left}px`;
		}
		host.style.opacity = "";
	}

	function scheduleHintPosition() {
		if (!stylesheetReady || !hints.length || hintFramePending) return;
		hintFramePending = true;
		requestAnimationFrame(() => {
			hintFramePending = false;
			positionHints();
		});
	}

	function hintPoint(element, press) {
		if (scrollHints && element === document.scrollingElement) return {x: innerWidth / 2, y: 0};
		const point = exposedPoint(element, press);
		if (!point?.blocked) return point;
	}

	function pressWrapper(element, {x, y}) {
		// Include click for wrappers that only handle click, as with a real mouse press.
		for (const type of ["mousedown", "mouseup", "click"]) {
			if (!element.isConnected) break;
			element.dispatchEvent(new MouseEvent(type, {
				bubbles: true, cancelable: true, composed: true, view: window,
				clientX: x, clientY: y, button: 0, buttons: type === "mousedown" ? 1 : 0, detail: 1
			}));
		}
	}

	function chooseHint(label, event) {
		if (!stylesheetReady) return;
		const remaining = hints.filter(hint => hint.label.startsWith(label));
		if (!remaining.length) {
			clearOverlay();
		} else if (remaining.length === 1 && remaining[0].label === label) {
			const {element, press} = remaining[0];
			clearOverlay();
			if (scrollHints) {
				if (!hintPoint(element)) return;
				scrollTarget = element;
				const editor = event.composedPath().find(editable);
				if (editor) focusScrollArea(editor);
				showScrollOutline(element);
			} else {
				const point = press ? hintPoint(element, true) :
					exposedPoint(element, !element.matches(independentSelector));
				if (!point || !clickable(element)) return;
				if (press) {
					pressWrapper(element, point);
				} else {
					if (editable(point.target)) point.target.focus();
					point.target.click();
				}
			}
		} else {
			hintPrefix = label;
			positionHints();
		}
	}

	function scrollable(element) {
		if (element === document.body || element === document.scrollingElement) return false;
		const style = getComputedStyle(element);
		return (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) ||
			(/(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1);
	}

	function focusWithoutScrolling(target) {
		if (!target.focus) return false;
		const needsTabIndex = target.tabIndex < 0 && !target.hasAttribute("tabindex");
		if (needsTabIndex) target.setAttribute("tabindex", "-1");
		target.focus({preventScroll: true});
		const focused = target.getRootNode().activeElement === target;
		if (needsTabIndex) {
			const restoreTabIndex = () => {
				if (target.getAttribute("tabindex") === "-1") target.removeAttribute("tabindex");
			};
			if (focused) target.addEventListener("blur", restoreTabIndex, {once: true});
			else restoreTabIndex();
		}
		return focused;
	}

	function focusScrollArea(editor) {
		const modal = [...ancestors(editor)].find(element => element.matches(':modal, [aria-modal="true"]'));
		if (scrollTarget?.isConnected && scrollTarget !== document.scrollingElement) {
			const path = [...ancestors(scrollTarget)];
			if ((!modal || path.includes(modal)) && !path.some(editable) && focusWithoutScrolling(scrollTarget)) return;
		}
		focusWithoutScrolling(modal || document.body || document.documentElement);
	}

	function scrollRect(element) {
		return element === document.scrollingElement
			? {top: 0, left: 0, width: innerWidth, height: innerHeight}
			: element.getBoundingClientRect();
	}

	function showScrollOutline(element) {
		const rect = scrollRect(element);
		const outline = document.createElement("div");
		outline.className = "scroll-target";
		Object.assign(outline.style, {
			top: `${rect.top}px`, left: `${rect.left}px`,
			width: `${rect.width}px`, height: `${rect.height}px`
		});
		shadow.append(outline);
		host.showPopover();
		scrollOutlineTimer = setTimeout(clearOverlay, 700);
	}

	function stopScroll() {
		if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
		scrollFrame = undefined;
		scrollMotion = undefined;
	}

	function animateScroll(time) {
		const motion = scrollMotion;
		if (!motion.target.isConnected) {
			stopScroll();
			return;
		}
		function advance(end, speed) {
			// Integrate the easing curve; CSS smooth scrolling must not animate each frame again.
			const elapsed = Math.min(end - motion.last, 50);
			const decay = Math.exp(-elapsed / scrollEaseMs);
			const distance = speed * elapsed + (motion.velocity - speed) * scrollEaseMs * (1 - decay);
			motion.velocity = speed + (motion.velocity - speed) * decay;
			motion.last = end;
			motion.target.scrollBy({[motion.axis]: distance / 1000, behavior: "instant"});
		}
		if (motion.last < motion.release) advance(Math.min(time, motion.release), motion.speed);
		if (time > motion.release) advance(time, 0);
		if (time >= motion.release && Math.abs(motion.velocity) < 2) {
			stopScroll();
		} else {
			scrollFrame = requestAnimationFrame(animateScroll);
		}
	}

	function scroll(key, fast) {
		if (!scrollTarget?.isConnected) scrollTarget = undefined;
		const target = scrollTarget || document.scrollingElement;
		if (!target) return;
		const vertical = key === "j" || key === "k";
		const axis = vertical ? "top" : "left";
		let speed = scrollSpeed;
		if (fast && vertical) {
			const height = target === document.scrollingElement ? innerHeight : target.clientHeight;
			speed = Math.max(2 * scrollSpeed, height * 1000 / (2 * scrollTapMs));
		}
		const now = performance.now();
		if (scrollMotion && (scrollMotion.target !== target || scrollMotion.axis !== axis)) stopScroll();
		if (!scrollMotion) scrollMotion = {target, axis, velocity: 0, last: now};
		Object.assign(scrollMotion, {
			key, speed: (key === "j" || key === "l" ? 1 : -1) * speed,
			minimumUntil: now + scrollTapMs, release: Infinity
		});
		if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(animateScroll);
	}

	document.addEventListener("keydown", event => {
		if (event.defaultPrevented || event.isComposing || event.altKey || event.metaKey) return;

		const key = event.key.toLowerCase();
		const scrollKey = /^[hjkl]$/.test(event.key) || (event.shiftKey && /^[jk]$/.test(key));
		if (event.ctrlKey) {
			if ((key !== "s" && key !== "c") || event.shiftKey) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!event.repeat) {
				const editor = key === "c" && event.composedPath().find(editable);
				showHints(key === "c");
				if (editor) focusScrollArea(editor);
			}
			return;
		}

		if (hints.length && scrollHints && scrollKey) clearOverlay();
		if (hints.length) {
			if (event.key === "Escape") {
				clearOverlay();
			} else if (event.key === "Backspace") {
				if (hintPrefix) {
					hintPrefix = hintPrefix.slice(0, -1);
					positionHints();
				}
			} else if (event.key.length === 1 && alphabet.includes(event.key.toUpperCase())) {
				if (!event.repeat) chooseHint(hintPrefix + event.key.toUpperCase(), event);
			} else {
				clearOverlay();
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}

		if (event.composedPath().some(editable)) return;
		if (key === "s") {
			showHints();
		} else if (scrollKey) {
			if (!event.repeat) scroll(key, event.shiftKey);
		} else {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
	}, true);

	document.addEventListener("keyup", event => {
		if (scrollMotion?.key === event.key.toLowerCase()) {
			scrollMotion.release = Math.max(performance.now(), scrollMotion.minimumUntil);
		}
	}, true);
	document.addEventListener("focusin", event => {
		if (event.composedPath().some(editable)) stopScroll();
	}, true);
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) stopScroll();
	});
	addEventListener("blur", stopScroll);
	addEventListener("pagehide", stopScroll);

	addEventListener("scroll", scheduleHintPosition, true);
	addEventListener("resize", scheduleHintPosition);
})();
