export function isAlmostExactWordMatch(query: string, label: string, minimumLength = 3) {
  const words = (value: string) =>
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}\p{M}]+/u)
      .filter(Boolean);
  return words(query).some(
    (queryWord) =>
      queryWord.length >= minimumLength && words(label).some((labelWord) => labelWord.startsWith(queryWord)),
  );
}
