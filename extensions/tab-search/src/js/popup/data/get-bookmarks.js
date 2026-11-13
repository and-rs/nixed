import addURLs from "./add-urls.js";

export default async function getBookmarks() {
	const bookmarks = [];
	const urls = new Set();

	function visit(nodes, path = []) {
		for (const node of nodes) {
			if (node.url && !urls.has(node.url)) {
				urls.add(node.url);
				bookmarks.push(addURLs({
					...node,
					kind: "bookmark",
					title: [...path, node.title || node.url].join(" / ")
				}));
			} else if (node.children) {
				const nested = node.parentId && node.parentId !== "0" && node.title;
				visit(node.children, nested ? [...path, node.title] : path);
			}
		}
	}

	visit(await chrome.bookmarks.getTree());
	return bookmarks.sort((a, b) => a.title.localeCompare(b.title));
}
