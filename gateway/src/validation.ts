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

export interface GatewayRequestPayload {
  request: OnlineRequest;
  canonicalBodyHash: string;
}

export async function readGatewayRequest(
  request: Request,
): Promise<GatewayRequestPayload> {
  if (contentLengthExceedsLimit(request.headers.get('content-length'))) {
    throw new GatewayHttpError(
      413,
      'payload_too_large',
      'Request body is too large.',
    );
  }

  const bytes = await readBoundedBody(request);
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request body is not valid UTF-8.',
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

  let onlineRequest: OnlineRequest;
  try {
    onlineRequest = validateOnlineRequest(parsed);
  } catch {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request contract is invalid.',
    );
  }

  return {
    request: onlineRequest,
    canonicalBodyHash: await sha256Hex(bytes),
  };
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const body = request.body;
  if (!body) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request body is empty.',
    );
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk =
        value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > GATEWAY_MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new GatewayHttpError(
          413,
          'payload_too_large',
          'Request body is too large.',
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof GatewayHttpError) throw error;
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request stream failed.',
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      void 0;
    }
  }

  if (total === 0) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request body is empty.',
    );
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes).buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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
