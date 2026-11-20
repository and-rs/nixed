const CharPattern = /./g;
	// use a NUL character to replace the matches so nothing in subsequent query
	// tokens will match an existing match
const ReplacementChar = "\x00";


const numerically = (a, b) => a - b;
const keys = ["title", "displayURL"];


function replaceMatches(
	string,
	matches)
{
	const start = matches[0];
	const end = matches[matches.length - 1];
	const replacementSection = string.slice(start, end + 1);
	const indexes = [...matches];
	let nextIndex = indexes.shift();

	return string.slice(0, start) +
		replacementSection.replace(CharPattern, (char, i) => {
			if (start + i === nextIndex) {
				nextIndex = indexes.shift();

				return ReplacementChar;
			} else {
				return char;
			}
		}) +
		string.slice(end + 1);
}


function sumScores(
	tokenScores)
{
	let total = 0;

	for (const score of tokenScores) {
		if (!score) {
			return 0;
		}

		total += score;
	}

	return total;
}



export default function(
	score)
{

	function compareScoredStrings(
		a,
		b)
	{
		if (a.score === b.score) {
			if (a.lastVisit && b.lastVisit) {
				return b.lastVisit - a.lastVisit;
			} else {
				return a.title.toLocaleLowerCase() < b.title.toLocaleLowerCase() ? -1 : 1;
			}
		} else {
			return b.score - a.score;
		}
	}


	return function scoreArray(items, tokens) {
		for (const item of items) {
			item.hitMasks = {};
			const tokenScores = new Array(tokens.length).fill(0);

			for (const key of keys) {
				const hitMask = [];
				let string = item[key];
				for (let i = 0; string && i < tokens.length; i++) {
					const tokenMatches = [];
					const tokenScore = score(string, tokens[i], tokenMatches);
					if (!tokenScore) continue;
					if (i + 1 < tokens.length) string = replaceMatches(string, tokenMatches);
					hitMask.push(...tokenMatches);
					tokenScores[i] = Math.max(tokenScore, tokenScores[i]);
				}
				item.hitMasks[key] = hitMask.sort(numerically);
			}

			// Every token must match at least one field.
			item.score = sumScores(tokenScores);
		}

		items.sort(compareScoredStrings);

		return items;
	}
}
