import CryptoJS from 'crypto-js';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

export function sha256Placeholder(input: unknown): string {
  const payload = typeof input === 'string' ? input : stableStringify(input);

  return CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);
}

export function hmacPlaceholder(payload: unknown, secret: string): string {
  return CryptoJS.HmacSHA256(stableStringify(payload), secret).toString(CryptoJS.enc.Hex);
}
