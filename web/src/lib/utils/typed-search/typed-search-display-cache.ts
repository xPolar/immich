const displayPrefix = 'typed-search:display:';

export function storeTypedSearchDisplayText(destination: string, displayText: string) {
  if (typeof sessionStorage === 'undefined') {
    return;
  }

  const trimmedDisplayText = displayText.trim();
  if (trimmedDisplayText) {
    sessionStorage.setItem(`${displayPrefix}${destination}`, trimmedDisplayText);
  }
}

export function getTypedSearchDisplayText(destination: string) {
  if (typeof sessionStorage === 'undefined') {
    return undefined;
  }

  return sessionStorage.getItem(`${displayPrefix}${destination}`) ?? undefined;
}
