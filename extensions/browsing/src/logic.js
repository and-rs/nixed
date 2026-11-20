/* Shared by the content script, navigation worker, and focused tests. */
globalThis.Browsing = {
	redirect(url, redirects) {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol)) return null;
		const path = parsed.pathname.replace(/\/+$/, "") || "/";
		return redirects.find(rule =>
			rule.hosts.includes(parsed.hostname) &&
			rule.paths.some(candidate => (candidate.replace(/\/+$/, "") || "/") === path)
		)?.to ?? null;
	},

	metadataURL(url) {
		const parsed = new URL(url);
		const post = parsed.pathname.match(/^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i);
		if (post) return `https://www.reddit.com/comments/${post[1]}.json?raw_json=1&limit=1`;
		const community = parsed.pathname.match(/^\/r\/([^/]+)(?:\/|$)/i);
		if (community) return `https://www.reddit.com/r/${encodeURIComponent(community[1])}/about.json?raw_json=1`;
		const profile = parsed.pathname.match(/^\/(?:user|u)\/([^/]+)(?:\/(?:overview|submitted|comments|posts))?\/?$/i);
		if (profile) return `https://www.reddit.com/user/${encodeURIComponent(profile[1])}/about.json?raw_json=1`;
		return null;
	},

	nsfwMetadata(value) {
		const data = Array.isArray(value) ? value[0]?.data?.children?.[0]?.data : value?.data;
		const nsfw = data?.over_18 ?? data?.over18 ?? data?.subreddit?.over_18;
		if (typeof nsfw !== "boolean") throw new Error("Missing NSFW metadata");
		return nsfw;
	},
};
