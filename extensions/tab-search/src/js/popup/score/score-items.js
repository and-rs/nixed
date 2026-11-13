import quickScore from "./quick-score.js";
import simpleScore from "./simple-score.js";
import arrayScore from "./array-score.js";

const fuzzy = arrayScore(quickScore);
const simple = arrayScore(simpleScore);

export default function scoreItems(items, query) {
	const tokens = query.trim().split(/\s+/);
	if (!tokens[0]) return items;
	const length = tokens.reduce((total, token) => total + token.length, 0);
	const score = length <= 28 && length / tokens.length <= 14 ? fuzzy : simple;
	return score([...items], tokens).filter(item => item.score > 0);
}
