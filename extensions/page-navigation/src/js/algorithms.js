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

	globalThis.PageNavigation = {alphabet, labelsFor};
})();
