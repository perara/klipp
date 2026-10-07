import { validateHeaderName, type IncomingMessage } from 'node:http';
import { fromKlipp, hostOf, isLocalName } from '../server/guard.js';

export interface BoxIdentityOptions {
  /** Set only by a sign-in proxy which is the only caller allowed to reach the port. */
  header: string;
  /** A single proxy-set comma list of validated roles. */
  rolesHeader: string;
  /** Exact, case-sensitive role required for every UI request. */
  requiredRole: string;
}

const DOMAIN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const EMAIL = /^[a-z0-9.!#$%&*+/=?^_{|}~-]{1,64}@([^@]+)$/i;
const ROLE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const email = (value: string) => DOMAIN.test(EMAIL.exec(value)?.[1] ?? '');

/** Validates before the server creates any data or starts any CLI. */
export class BoxIdentity {
  private readonly header: string;
  private readonly rolesHeader: string;
  private readonly requiredRole: string;
  readonly publicHost: string | undefined;

  constructor(options: BoxIdentityOptions, publicHost?: string) {
    const header = (name: string, setting: string) => {
      try {
        validateHeaderName(name);
      } catch {
        throw new Error(`${setting} must name a dedicated proxy header.`);
      }
      const lower = name.toLowerCase();
      if (
        /^(?:host|authorization|origin|x-klipp|sec-.*|content-.*|connection|cookie|forwarded|via|x-forwarded-.*)$/.test(
          lower,
        )
      ) {
        throw new Error(`${setting} must name a dedicated proxy header.`);
      }
      return lower;
    };
    this.header = header(options.header, 'KLIPP_BOX_IDENTITY_HEADER');
    if (!ROLE.test(options.requiredRole ?? '')) {
      throw new Error(
        'KLIPP_BOX_REQUIRED_ROLE is required with KLIPP_BOX_IDENTITY_HEADER: one exact role.',
      );
    }
    this.requiredRole = options.requiredRole;
    this.rolesHeader = header(options.rolesHeader, 'KLIPP_BOX_ROLES_HEADER');
    if (this.header === this.rolesHeader) {
      throw new Error('KLIPP_BOX_ROLES_HEADER and KLIPP_BOX_IDENTITY_HEADER must be different.');
    }
    if (publicHost !== undefined && !DOMAIN.test(publicHost)) {
      throw new Error(
        'KLIPP_BOX_PUBLIC_HOST must be a public hostname without a scheme, port or path.',
      );
    }
    this.publicHost = publicHost?.toLowerCase();
  }

  userOf(req: IncomingMessage): { user: string } | { refused: [number, string] } {
    // Node joins duplicate custom headers. Inspect the wire headers too, even for identical
    // duplicates: a proxy and an application must never disagree about which value is trusted.
    const single = (name: string) => {
      let count = 0;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]?.toLowerCase() === name) count++;
      }
      const value = req.headers[name];
      return count === 1 && typeof value === 'string' ? value : undefined;
    };
    const value = single(this.header);
    if (value === undefined || !email(value.trim())) {
      return {
        refused: [
          401,
          'Sign in to Smia through the sign-in proxy. A single validated email is required.',
        ],
      };
    }
    const user = value.trim().toLowerCase();
    const roles = single(this.rolesHeader)
      ?.split(',')
      .map((role) => role.trim());
    if (
      !roles ||
      roles.some((role) => !ROLE.test(role)) ||
      new Set(roles).size !== roles.length ||
      !roles.includes(this.requiredRole)
    ) {
      return {
        refused: [
          403,
          'Your account needs the required role to use Smia here. Ask the owner for access.',
        ],
      };
    }
    return { user };
  }

  acceptsHost(req: IncomingMessage): boolean {
    const host = hostOf(req);
    return (
      isLocalName(req) ||
      (this.publicHost !== undefined &&
        (host === this.publicHost || host === `${this.publicHost}:443`))
    );
  }

  fromPage(req: IncomingMessage): boolean {
    if (req.headers['x-klipp'] !== '1') return false;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (this.publicHost && origin === `https://${this.publicHost}`) return true;
    // A public host must use HTTPS. Preserve the local page's origin behaviour for tunnels.
    return isLocalName(req) && fromKlipp(req);
  }
}
