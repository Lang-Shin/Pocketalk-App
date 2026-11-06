import {
  AuthenticationError,
  AuthenticatorUnavailableError,
} from './errors';

export interface AuthenticatedIdentity {
  subject: string;
  expiresAt?: number;
}

export interface Authenticator {
  authenticate(credential: string): Promise<AuthenticatedIdentity>;
}

export class FakeAuthenticator implements Authenticator {
  constructor(
    private readonly identities: ReadonlyMap<
      string,
      AuthenticatedIdentity | 'expired'
    >,
  ) {}

  async authenticate(credential: string): Promise<AuthenticatedIdentity> {
    const identity = this.identities.get(credential);
    if (!identity) {
      throw new AuthenticationError('invalid');
    }
    if (identity === 'expired') {
      throw new AuthenticationError('expired');
    }
    if (!identity.subject.trim()) {
      throw new AuthenticationError('invalid');
    }
    return identity;
  }
}

export function unavailableAuthenticator(): Authenticator {
  return {
    async authenticate() {
      throw new AuthenticatorUnavailableError();
    },
  };
}
