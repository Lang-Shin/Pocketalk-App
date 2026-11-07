import { QuotaConfigError, validateQuotaKey } from './types';

export type QuotaIdentityPseudonymizer = (
  subject: string,
) => Promise<string> | string;

export async function hmacIdentityKey(
  subject: string,
  secret: string,
): Promise<string> {
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    throw new QuotaConfigError('Identity subject is required.');
  }
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new QuotaConfigError(
      'Identity secret must be at least 32 characters.',
    );
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(subject)),
  );
  let hex = '';
  for (const byte of signature) {
    hex += byte.toString(16).padStart(2, '0');
  }
  validateQuotaKey(hex, 'identityKey');
  return hex;
}
