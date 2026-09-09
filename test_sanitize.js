const SANITIZE_LONE_SURROGATES_REGEX = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;

console.log("Consecutive lone low surrogates:");
console.log("\uDC00\uDC00".replace(SANITIZE_LONE_SURROGATES_REGEX, "").length === 0);

console.log("Consecutive lone high surrogates:");
console.log("\uD800\uD800".replace(SANITIZE_LONE_SURROGATES_REGEX, "").length === 0);

console.log("Valid surrogate pair:");
console.log("\uD83D\uDE00".replace(SANITIZE_LONE_SURROGATES_REGEX, "").length === 2);
