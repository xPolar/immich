export function isAlmostExactWordMatch(query: string, label: string, minimumLength = 3) {
  const words = (value: string) =>
    value
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  return words(query).some(
    (queryWord) =>
      queryWord.length >= minimumLength && words(label).some((labelWord) => labelWord.startsWith(queryWord)),
  );
}
