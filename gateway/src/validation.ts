import {
  ONLINE_REQUEST_MAX_BYTES,
  parseOnlineResponseJson,
  validateOnlineRequest,
  type OnlineRequest,
  type OnlineResponse,
} from '../../src/ai/online/contract';
import { GatewayHttpError } from './errors';

export const GATEWAY_MAX_REQUEST_BYTES = ONLINE_REQUEST_MAX_BYTES;

export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export function contentLengthExceedsLimit(
  value: string | null,
  limit = GATEWAY_MAX_REQUEST_BYTES,
): boolean {
  if (!value) return false;
  const length = Number(value);
  return Number.isFinite(length) && length > limit;
}

export async function readGatewayRequest(
  request: Request,
): Promise<OnlineRequest> {
  let body: string;
  try {
    body = await request.text();
  } catch {
    throw new GatewayHttpError(400, 'invalid_request', 'Request body failed.');
  }
  if (utf8ByteLength(body) > GATEWAY_MAX_REQUEST_BYTES) {
    throw new GatewayHttpError(
      413,
      'payload_too_large',
      'Request body is too large.',
    );
  }
  if (!body.trim()) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request body is empty.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request JSON is malformed.',
    );
  }

  try {
    return validateOnlineRequest(parsed);
  } catch {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request contract is invalid.',
    );
  }
}

export function validateProviderOutput(value: unknown): OnlineResponse {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new GatewayHttpError(
      502,
      'invalid_provider_response',
      'Provider output is invalid.',
    );
  }
  if (typeof serialized !== 'string') {
    throw new GatewayHttpError(
      502,
      'invalid_provider_response',
      'Provider output is invalid.',
    );
  }
  try {
    return parseOnlineResponseJson(serialized);
  } catch {
    throw new GatewayHttpError(
      502,
      'invalid_provider_response',
      'Provider output is invalid.',
    );
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
