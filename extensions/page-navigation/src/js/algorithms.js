(() => {
	const alphabet = "ASDFGQWERTZXCVB";

	function labelsFor(count) {
		let width = 1;
		while (alphabet.length ** width < count) width++;
		return Array.from({length: count}, (_, index) => {
			let value = index;
			let label = "";
			for (let i = 0; i < width; i++) {
				label = alphabet[value % alphabet.length] + label;
				value = Math.floor(value / alphabet.length);
			}
			return label;
		});
	}

	function nextScrollTarget(targets, current) {
		if (!targets.length) return {target: undefined, index: 0};
		const index = (targets.indexOf(current) + 1) % targets.length;
		return {target: targets[index], index};
	}

	globalThis.PageNavigation = {alphabet, labelsFor, nextScrollTarget};
})();
