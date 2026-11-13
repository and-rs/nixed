const SyntaxPattern = /[\^$\\.*+?()[\]{}|]/g;
const LowercaseString = "abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżžƃƅƈƌƒƙơƣƥƨƭưƴƶƹƽǆǉǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǵǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗɓɔɗɘəɛɠɣɨɩɯɲɵʃʈʊʋʒḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ";
const AlphaRegexes = [
	...LowercaseString,
	...LowercaseString.toLocaleUpperCase(),
].map((char) => [char, createRegexCI(char)]);

	// precache the alphabet and other common single chars
const singleAlphaCache = new Map(AlphaRegexes);
const multiCharCache = new Map();

function createRegexCI(
	searchString)
{
	return new RegExp(searchString.replace(SyntaxPattern, "\\$&"), "i");
}

export function search(
	string,
	searchString)
{
	if (searchString.length === 1) {
		const regex = singleAlphaCache.get(searchString);
		return regex ? string.search(regex) : string.indexOf(searchString);
	}

	const regex = multiCharCache.get(searchString) || createRegexCI(searchString);
	multiCharCache.delete(searchString);
	multiCharCache.set(searchString, regex);
	if (multiCharCache.size > 1000) multiCharCache.delete(multiCharCache.keys().next().value);
	return string.search(regex);
}
