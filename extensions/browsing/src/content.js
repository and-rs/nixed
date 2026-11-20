(() => {
	const marked = [
		'shreddit-post[nsfw]:not([nsfw="false"])',
		'shreddit-post[over-18]:not([over-18="false"])',
		'[data-nsfw="true"]',
		'[data-over18="true"]',
		".thing.over18",
		'[slot="nsfw-badge"]',
		'[data-testid="nsfw-badge"]',
		'.Post [aria-label="NSFW"]',
		'.Post [title="NSFW"]',
	].join(",");
	const gates = [
		'shreddit-content-gate[reason="nsfw"]',
		'shreddit-content-gate[reason="over18"]',
		'[data-testid="content-gate"]',
		".interstitial.over18",
		'form[action*="/over18"]',
	].join(",");
	let blocked = false;
	let lastURL;
	let generation = 0;
	let scheduled = false;
	let checking = false;

	function setChecking(value) {
		checking = value;
		const root = document.documentElement;
		if (!root) return;
		if (value) root.setAttribute("data-browsing-checking", "");
		else root.removeAttribute("data-browsing-checking");
		root.setAttribute("data-browsing-ready", "");
	}

	function block() {
		if (blocked) return;
		blocked = true;
		setChecking(true);
		location.replace(chrome.runtime.getURL("blocked.html"));
	}

	async function checkNavigation() {
		const url = location.href;
		if (url === lastURL) return;
		lastURL = url;
		const current = ++generation;
		const target = Browsing.redirect(url, browsingConfig.redirects);
		if (target) {
			setChecking(true);
			location.replace(target);
			return;
		}
		const metadata = Browsing.metadataURL(url);
		if (!metadata) {
			setChecking(false);
			return;
		}
		setChecking(true);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);
		try {
			const response = await fetch(metadata, {credentials: "include", signal: controller.signal});
			if (!response.ok) throw new Error("Unable to verify Reddit page");
			const nsfw = Browsing.nsfwMetadata(await response.json());
			if (current !== generation || location.href !== url) return;
			if (nsfw) block();
			else if (!blocked) setChecking(false);
		} catch {
			// No reveal/retry bypass when Reddit cannot provide trustworthy metadata.
			if (current === generation && location.href === url) block();
		} finally {
			clearTimeout(timeout);
		}
	}

	function filter() {
		scheduled = false;
		if (blocked) return;
		setChecking(checking);
		checkNavigation();
		if (document.querySelector(gates)) {
			block();
			return;
		}
		for (const marker of document.querySelectorAll(marked)) {
			const post = marker.closest("shreddit-post, .thing, .Post, article");
			// Removing rather than blurring leaves no reveal control to activate.
			(post || marker).remove();
		}
	}

	new MutationObserver(() => {
		if (scheduled || blocked) return;
		scheduled = true;
		requestAnimationFrame(filter);
	}).observe(document, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["nsfw", "over-18", "data-nsfw", "data-over18", "reason", "class", "slot", "aria-label", "title", "data-testid"],
	});
	chrome.runtime.onMessage.addListener(message => {
		if (message.type === "browsing-navigation") filter();
	});
	addEventListener("popstate", filter);
	addEventListener("pageshow", filter);
	filter();
})();
