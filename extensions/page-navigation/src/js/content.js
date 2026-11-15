(() => {
	const {alphabet, labelsFor, nextScrollTarget} = PageNavigation;
	const editableSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
	const host = document.createElement("div");
	host.id = "page-navigation-host";
	host.popover = "manual";
	host.style.cssText = "position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;pointer-events:none";
	const shadow = host.attachShadow({mode: "open"});
	const stylesheet = document.createElement("link");
	stylesheet.rel = "stylesheet";
	stylesheet.href = chrome.runtime.getURL("css/page-navigation.css");
	stylesheet.addEventListener("load", positionHints);
	shadow.append(stylesheet);
	(document.documentElement || document).append(host);

	let hints = [];
	let hintPrefix = "";
	let scrollTargets;
	let scrollIndex = 0;
	let scrollRefresh;

	function editable(element) {
		return element?.closest?.(editableSelector);
	}

	function visible(element) {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 &&
			style.visibility !== "hidden" &&
			Number(style.opacity) > 0 &&
			rect.bottom > 0 && rect.right > 0 &&
			rect.top < innerHeight && rect.left < innerWidth;
	}

	function clickable(element) {
		return !element.disabled && !element.readOnly && !element.hasAttribute("disabled") &&
			element.getAttribute("aria-disabled") !== "true" &&
			!element.closest("[inert], [aria-hidden='true']") && visible(element);
	}

	function candidates(root) {
		const selector = [
			"a[href]", "area[href]", "button", editableSelector,
			"[role=button]", "[role=link]",
			"[tabindex]:not([tabindex='-1'])"
		].join(",");
		const elements = [...root.querySelectorAll(selector)].filter(clickable);
		const candidates = new Set(elements);
		return elements.filter(element => {
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				if (candidates.has(parent) && parent.matches("a[href],button,[role=button],[role=link]")) {
					return false;
				}
			}
			return true;
		});
	}

	function clearHints() {
		hints = [];
		hintPrefix = "";
		shadow.querySelectorAll(".hint").forEach(element => element.remove());
		if (!scrollRefresh) host.hidePopover();
	}

	function showOverlay() {
		const modal = document.querySelector(":modal");
		(modal || document.documentElement).append(host);
		host.hidePopover();
		host.showPopover();
	}

	function showHints() {
		clearHints();
		const elements = candidates(document.querySelector(":modal") || document);
		if (!elements.length) return;
		const labels = labelsFor(elements.length);
		hints = elements.map((element, index) => ({
			element,
			label: labels[index],
			node: document.createElement("span")
		}));
		for (const hint of hints) {
			hint.node.className = "hint";
			shadow.append(hint.node);
		}
		showOverlay();
		positionHints();
	}

	function positionHints() {
		const placed = [];
		for (const hint of hints) {
			hint.node.hidden = !hint.label.startsWith(hintPrefix) ||
				!hint.element.isConnected || !visible(hint.element);
			hint.node.textContent = hint.label.slice(hintPrefix.length);
			if (hint.node.hidden) continue;
			const rect = hint.element.getBoundingClientRect();
			const left = Math.max(0, Math.min(
				rect.left + (rect.width - hint.node.offsetWidth) / 2,
				innerWidth - hint.node.offsetWidth
			));
			let top = Math.max(0, Math.min(rect.top, innerHeight - hint.node.offsetHeight));
			while (placed.some(other => left < other.right && left + hint.node.offsetWidth > other.left &&
				top < other.bottom && top + hint.node.offsetHeight > other.top) &&
				top + hint.node.offsetHeight < innerHeight) {
				top += hint.node.offsetHeight + 2;
			}
			hint.node.style.top = `${top}px`;
			hint.node.style.left = `${left}px`;
			placed.push({
				left, top,
				right: left + hint.node.offsetWidth,
				bottom: top + hint.node.offsetHeight
			});
		}
	}

	function chooseHint(label) {
		const remaining = hints.filter(hint => hint.label.startsWith(label));
		if (!remaining.length) {
			clearHints();
		} else if (remaining.length === 1 && remaining[0].label === label) {
			const element = remaining[0].element;
			clearHints();
			if (editable(element)) element.focus();
			element.click();
		} else {
			hintPrefix = label;
			positionHints();
		}
	}

	function scrollable(element) {
		if (element === document.body || element === document.documentElement) return false;
		const style = getComputedStyle(element);
		return (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) ||
			(/(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1);
	}

	function getScrollTargets() {
		const root = document.scrollingElement;
		const nested = [...document.querySelectorAll("*")]
			.filter(element => scrollable(element) && visible(element));
		return [root, ...nested].filter(Boolean);
	}

	function clearScrollTarget() {
		clearTimeout(scrollRefresh);
		scrollRefresh = undefined;
		shadow.querySelectorAll(".scroll-target, .scroll-label").forEach(element => element.remove());
		if (!hints.length) host.hidePopover();
	}

	function showScrollTarget(element, index, total) {
		clearScrollTarget();
		const rect = element === document.scrollingElement
			? {top: 0, left: 0, width: innerWidth, height: innerHeight}
			: element.getBoundingClientRect();
		const outline = document.createElement("div");
		outline.className = "scroll-target";
		Object.assign(outline.style, {
			top: `${rect.top}px`, left: `${rect.left}px`,
			width: `${rect.width}px`, height: `${rect.height}px`
		});
		const label = document.createElement("div");
		label.className = "scroll-label";
		label.textContent = `Scroll area ${index + 1} of ${total}`;
		label.style.top = `${Math.max(0, rect.top)}px`;
		label.style.left = `${Math.max(0, rect.left)}px`;
		shadow.append(outline, label);
		showOverlay();
		scrollRefresh = setTimeout(clearScrollTarget, 700);
	}

	function cycleScrollTarget() {
		const previous = scrollTargets?.[scrollIndex];
		scrollTargets = getScrollTargets();
		const next = nextScrollTarget(scrollTargets, previous);
		scrollIndex = next.index;
		const target = next.target;
		if (target) showScrollTarget(target, scrollIndex, scrollTargets.length);
	}

	function scroll(direction) {
		if (!scrollTargets || !scrollTargets[scrollIndex]?.isConnected) {
			scrollTargets = getScrollTargets();
			scrollIndex = 0;
		}
		const target = scrollTargets[scrollIndex] || document.scrollingElement;
		target?.scrollBy({top: direction * 70, behavior: "smooth"});
	}

	document.addEventListener("keydown", event => {
		if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey ||
			event.metaKey || editable(event.target)) return;

		if (hints.length) {
			if (event.key === "Escape") {
				clearHints();
			} else if (event.key === "Backspace") {
				chooseHint(hintPrefix.slice(0, -1));
			} else if (alphabet.includes(event.key.toUpperCase())) {
				chooseHint(hintPrefix + event.key.toUpperCase());
			} else {
				clearHints();
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}

		if (event.key === "s" || event.key === "S") {
			showHints();
		} else if (event.key === "j" || event.key === "k") {
			scroll(event.key === "j" ? 1 : -1);
		} else if (event.key.toLowerCase() === "c" && event.shiftKey) {
			cycleScrollTarget();
		} else {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
	}, true);

	addEventListener("scroll", () => {
		if (hints.length) requestAnimationFrame(positionHints);
	}, true);
	addEventListener("resize", () => {
		if (hints.length) positionHints();
	});
})();
