export const getHammingDistance = (first: bigint, second: bigint): number => {
  let difference = first ^ second;
  let distance = 0;
  while (difference > 0) {
    distance++;
    difference &= difference - 1n;
  }
  return distance;
};
