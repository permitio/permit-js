import ky from 'ky';
import { ApproveInterface, LoginInterface, LoginMethod } from './types'
import {sendTokenToIframe} from "./sendToken";

// The embed origins Permit SaaS serves Elements from.
export const PERMIT_URL = /^https:\/\/([a-z0-9]{32}\.)?embed(\.api)?(\.stg)?\.permit\.io$/;
const PERMIT_API_URL = "https://api.permit.io";
const PERMIT_STG_API_URL = "https://api.stg.permit.io";
// How long the login iframe lives; no answer can arrive once it is removed.
const IFRAME_LIFETIME_MS = 3000;
// How long logout() waits for its request before resolving. Its iframe stays until it has
// loaded, so a slow request still completes.
const LOGOUT_WAIT_MS = 10000;
// How long a login request may take, its response body included.
const LOGIN_REQUEST_MS = 10000;
const ENV_ID = /^[0-9a-f]{32}$/;

/** An environment id as the embed host spells it (32 hex digits), or undefined. */
function envIdHex(envId: unknown): string | undefined {
  const hex = String(envId ?? '').replace(/-/g, '').toLowerCase();
  return ENV_ID.test(hex) ? hex : undefined;
}

// An IPv4 or bracketed IPv6 host.
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/** `permitApiUrl` parsed, if it is an http or https URL; otherwise undefined. */
function apiUrl(permitApiUrl: string): URL | undefined {
  try {
    const api = new URL(permitApiUrl);
    return api.protocol === 'https:' || api.protocol === 'http:' ? api : undefined;
  } catch {
    return undefined;
  }
}

/** A `trustedOrigins` entry as `event.origin` spells it; throws unless it is an http(s) URL. */
function trustedOrigin(entry: string): string {
  const url = apiUrl(entry);
  if (url === undefined) {
    throw new Error(`login: trustedOrigins entry ${entry} must be an http(s) URL`);
  }
  return url.origin;
}

/**
 * `permitApiUrl` without one trailing `/`, if it is a path on the page's own origin (e.g.
 * `/permit-api`, or `/` for the page's root), which a frontendOnly login's request
 * resolves against the page; otherwise undefined. It names no deployment, so login success
 * answers are then taken from Permit SaaS origins only. The URL checked is the one
 * requested, since a path such as `//` followed by `/v2/auth/...` would leave the page's
 * origin.
 */
function pagePath(permitApiUrl: string): string | undefined {
  if (typeof permitApiUrl !== 'string' || !permitApiUrl.startsWith('/')) {
    return undefined;
  }
  const path = permitApiUrl.endsWith('/') ? permitApiUrl.slice(0, -1) : permitApiUrl;
  const base = 'https://page.invalid';
  try {
    return new URL(`${path}/v2/auth/`, base).origin === base ? path : undefined;
  } catch {
    return undefined;
  }
}

/** A deployment reached on localhost or by IP address serves Elements from its API origin. */
function servesEmbedFromApiOrigin(api: URL): boolean {
  return api.hostname === 'localhost' || IP_HOST.test(api.hostname);
}

/**
 * Where the deployment `permitApiUrl` names serves Elements for an environment:
 * `<scheme>://<env id>.embed.<its host>`, or its own origin on localhost or an IP address.
 * Undefined for an invalid env id, or for a URL that is not http or https.
 */
function embedOriginFor(permitApiUrl: string, envId: unknown): string | undefined {
  const hex = envIdHex(envId);
  const api = apiUrl(permitApiUrl);
  if (hex === undefined || api === undefined) {
    return undefined;
  }
  return servesEmbedFromApiOrigin(api) ? api.origin : `${api.protocol}//${hex}.embed.${api.host}`;
}

/**
 * Whether `origin` serves Permit Elements: a Permit SaaS embed origin, the embed origin of
 * an environment on the deployment `permitApiUrl` names, or one of `trustedOrigins`.
 */
export function isPermitEmbedOrigin(
  origin: string,
  permitApiUrl: string = PERMIT_API_URL,
  trustedOrigins: readonly string[] = [],
): boolean {
  return PERMIT_URL.test(origin) || trustedOrigins.includes(origin)
    || isDeploymentEmbedOrigin(origin, permitApiUrl);
}

/** Whether `origin` is the embed origin of an environment on the deployment `permitApiUrl` names. */
function isDeploymentEmbedOrigin(origin: string, permitApiUrl: string): boolean {
  const api = apiUrl(permitApiUrl);
  if (api === undefined) {
    return false;
  }
  if (servesEmbedFromApiOrigin(api)) {
    return origin === api.origin;
  }
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false;
  }
  const envId = from.hostname.split('.')[0];
  return envIdHex(envId) === envId && from.origin === embedOriginFor(permitApiUrl, envId);
}

// The login iframe's error page sends the error URL-encoded; a malformed one is passed on as it is.
function loginError(error: unknown): string {
  if (typeof error !== 'string') {
    return 'Permit Elements login failed';
  }
  try {
    return decodeURIComponent(error);
  } catch {
    return error;
  }
}

export class PermitElements {
  config?: RequestInit;
  isConnected: boolean;
  me?: any;
  isDev = false;
  // The API URL of the deployment that answered the last successful login, so logout() and
  // approve() reach it.
  permitApiUrl = PERMIT_API_URL;
  // The origin that answered the last successful login: it holds the session logout() ends.
  private sessionOrigin?: string;
  // The login or logout still running, if any: each call waits for the one before it.
  private pending?: Promise<void>;
  constructor() {
    this.config = { credentials: 'include' }
    this.isConnected = false;
  }

  loginWithAjax = async ({
    loginUrl,
    loginMethod,
    tenant,
    token,
    headers,
    userJwt,
    userKeyClaim,
  }: LoginInterface) => {
    let postData: any = { tenant: tenant };
    if (loginMethod === LoginMethod.bearer) {
      if (token === undefined) {
        throw new Error('When using bearer login, token must be defined');
      }
      this.config = {
        ...this.config,
        headers: { ...this.config.headers, Authorization: `Bearer ${token}` }
      }
    }

    if (loginMethod === LoginMethod.supportsPrivateBrowser) {
      if (token) {
        this.config = {
          ...this.config,
          headers: {...this.config.headers, Authorization: `Bearer ${token}`}
        }
      }
      if (headers) {
        this.config = {...this.config, headers: {...headers}}
      }
      this.config = {
        ...this.config,
        headers: {...this.config.headers}
      }
    }


    if (loginMethod === LoginMethod.header) {
      if (headers === undefined) {
        throw new Error('When using header login, headers must be defined');
      }
      this.config = { ...this.config, headers: { ...headers } }
    }
    if (loginMethod === LoginMethod.frontendOnly) {
      if (tenant === undefined) {
        throw new Error('When using frontendOnly login, tenant must be defined');
      }
      postData = { tenant_id: tenant, user_jwt: userJwt };
      if (userKeyClaim !== undefined) {
        postData = { ...postData, user_key_claim: userKeyClaim };
      }
    } else {
      if (userKeyClaim !== undefined) {
        console.warn('userKeyClaim will be used only when using frontendOnly login method');
      }
    }

    // ky's own timeout ends once the headers arrive; this abort also stops the body read.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), LOGIN_REQUEST_MS);
    // The options are taken now: approve() replaces this.config's headers. Only the call is
    // deferred, so a request ky refuses at once takes the same catch.
    const options = { json: postData, ...this.config, signal: abort.signal };
    return Promise.resolve()
      .then(() => ky.post(loginUrl, options).json())
      .then((data: any) => {
        clearTimeout(timer);
        if (loginMethod === LoginMethod.frontendOnly) {
          return data.redirect_url;
        } else {
          return data.url;
        }
      })
      .catch((error) => {
        clearTimeout(timer);
        this.isConnected = false;
        console.error(error);
        if (abort.signal.aborted) {
          throw new Error(`The Permit Elements login request took longer than ${LOGIN_REQUEST_MS / 1000} seconds`);
        }
        throw new Error('Error while trying to login, make sure that you\'ve created a login as route in your application and passed the right credentials');
      });
  }

  /**
   * Runs logins and logouts one at a time, in call order, so a logout can't race the login
   * before it, or a login the logout before it. When nothing is running, `operation` starts
   * at once, in the caller's task.
   */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    const settled = new Promise<void>((resolve) => { release = resolve; });
    this.pending = settled;
    const done = () => {
      if (this.pending === settled) this.pending = undefined;
      release();
    };
    let run: Promise<T>;
    try {
      run = previous === undefined ? operation() : previous.then(operation);
    } catch (error) {
      // e.g. login() called without arguments: its parameters are read before the async body.
      run = Promise.reject(error);
    }
    // The caller gets a promise of its own, so a rejection it ignores is still reported.
    return run.then(
      (value) => { done(); return value; },
      (error) => { done(); throw error; },
    );
  }

  login = (args: LoginInterface): Promise<boolean> => this.serialize(() => this.startLogin(args));

  private startLogin = async ({
    loginUrl,
    loginMethod = LoginMethod.cookie,
    tenant,
    token,
    headers,
    userJwt,
    envId,
   elementIframeUrl,
    userKeyClaim,
    permitApiUrl = PERMIT_API_URL,
    trustedOrigins = [],
  }: LoginInterface): Promise<boolean> => {
    const path = apiUrl(permitApiUrl) === undefined ? pagePath(permitApiUrl) : undefined;
    if (apiUrl(permitApiUrl) === undefined && path === undefined) {
      throw new Error("login: permitApiUrl must be an http(s) URL or a path on this page's origin");
    }
    permitApiUrl = path ?? permitApiUrl;
    const trusted = trustedOrigins.map(trustedOrigin);
    if (this.isConnected) {
      console.info('Already connected, if you want to connect to another tenant, please logout first');
      return Promise.resolve(true);
    }
    let iframeUrl = loginUrl;
    if (loginMethod === LoginMethod.bearer || loginMethod === LoginMethod.header || loginMethod === LoginMethod.cookie) {
      if (loginUrl === undefined) {
        throw new Error('When using bearer, header or cookie login, loginUrl must be defined')
      }
    }

    if (loginMethod === LoginMethod.frontendOnly) {
      if (userJwt === undefined) {
        throw new Error('When using frontendOnly login, userJwt must be defined');
      }
      if (loginUrl !== undefined) {
        console.warn('When using frontendOnly login, loginUrl will be ignored');
      }
      if (envId === undefined) {
        throw new Error('When using frontendOnly login, envId must be defined');
      }
      loginUrl = `${permitApiUrl}/v2/auth/${envId}/elements_fe_login_as`;
      iframeUrl = await this.loginWithAjax({ loginUrl, loginMethod, tenant, token, userJwt, userKeyClaim });
    }

    if (loginMethod === LoginMethod.supportsPrivateBrowser) {
      if (!elementIframeUrl) {
        throw new Error('When using supportsPrivateBrowser login, elementIframeUrl must be defined');
      }
      const tokenWithOutCookie = await this.loginWithAjax({
        loginUrl,
        loginMethod,
        tenant,
        token,
        headers,
        userKeyClaim
      });

      sendTokenToIframe(tokenWithOutCookie, elementIframeUrl)
      return Promise.resolve(true);
    }



    if (loginMethod === LoginMethod.header || loginMethod === LoginMethod.bearer) {
      iframeUrl = await this.loginWithAjax({ loginUrl, loginMethod, tenant, token, headers, userKeyClaim });
    }

    if (loginMethod === LoginMethod.cookie) {
      if (tenant) {
        const separator = loginUrl.includes('?') ? '&' : '?';
        iframeUrl = `${loginUrl}${separator}tenant=${encodeURIComponent(tenant)}`;
      } else {
        iframeUrl = loginUrl;
      }
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'hidden';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.position = 'absolute';
    iframe.style.top = '-10px';
    iframe.style.left = '-10px';
    iframe.src = iframeUrl;
    return new Promise<boolean>((resolve, reject) => {
      // The login iframe's window, kept from when it was added: removing the iframe nulls
      // its contentWindow, which must not then match a message without a source.
      let frameWindow: Window | null = null;
      const stopListening = () => window.removeEventListener("message", onMessage, false);
      const onMessage = (msg: MessageEvent) => {
        // Only our login iframe answers, and only from a Permit embed origin. A success
        // answer also sets where logout() and approve() go, so it is never taken from
        // trustedOrigins, which are for error pages.
        if (frameWindow === null || msg.source !== frameWindow) {
          return;
        }
        if (msg.data?.success === true && isPermitEmbedOrigin(msg.origin, permitApiUrl)) {
          stopListening();
          this.isConnected = true;
          this.me = msg.data.me;
          // Later calls for other environments go to the deployment that answered: the one
          // permitApiUrl names, or else Permit SaaS, staging or production by the answer's
          // origin (e.g. a login through a proxy permitApiUrl).
          this.permitApiUrl = isDeploymentEmbedOrigin(msg.origin, permitApiUrl)
            ? permitApiUrl
            : /\.stg\.permit\.io$/.test(msg.origin) ? PERMIT_STG_API_URL : PERMIT_API_URL;
          this.sessionOrigin = msg.origin;
          resolve(true);
        } else if (
          msg.data?.success === false
          && isPermitEmbedOrigin(msg.origin, permitApiUrl, trusted)
        ) {
          stopListening();
          this.isConnected = false;
          reject(loginError(msg.data.error));
        }
      };
      window.addEventListener("message", onMessage, false);
      try {
        document.body.appendChild(iframe);
      } catch (error) {
        stopListening();
        throw error;
      }
      frameWindow = iframe.contentWindow;
      // No answer can come once the iframe is gone: login() rejects. After an answer,
      // reject() is a no-op.
      setTimeout(() => {
        iframe.remove();
        stopListening();
        reject(new Error(
          'The Permit Elements login did not answer; not connected. A deployment other '
          + 'than Permit SaaS must pass its API URL as permitApiUrl.',
        ));
      }, IFRAME_LIFETIME_MS);
    });

  }

  approve = async ({inviteCode, email, token, envId, user_key_claim="sub", attributes = {}, permitApiUrl}: ApproveInterface) => {
    const envHex = envIdHex(envId);
    if (envHex === undefined) {
      throw new Error('approve: envId must be a Permit environment id');
    }
    const embedOrigin = permitApiUrl === undefined && this.sessionEnvId() === envHex
      ? this.sessionOrigin
      : embedOriginFor(permitApiUrl ?? this.permitApiUrl, envHex);
    if (embedOrigin === undefined) {
      throw new Error('approve: permitApiUrl must be an http(s) URL');
    }
    if (typeof inviteCode !== 'string' || inviteCode === '' || inviteCode === '.' || inviteCode === '..') {
      throw new Error('approve: inviteCode must be an invite code');
    }
    // One path segment, whatever the code holds.
    const approveUrl = `${embedOrigin}/v2/auth/${envHex}/user_invites/${encodeURIComponent(inviteCode)}/approve`;
    const params = {
      email: email,
      user_key_claim: user_key_claim,
      attributes: attributes,
    }
    this.config = {
      ...this.config,
      headers: { Authorization: `Bearer ${token}` }
    }
    return ky
      .post(approveUrl, {json: params, ...this.config}).json()
      .then((data) => {
        return data;
      })
      .catch((error) => {
        console.error(error);
        throw new Error('Error while trying to approve invite');
      });
  }


  logout = (logoutCustomUrl?: string): Promise<boolean> =>
    this.serialize(() => this.endSession(logoutCustomUrl));

  /** The environment of the current login session, if it has one. */
  private sessionEnvId(): string | undefined {
    return this.sessionOrigin === undefined ? undefined : envIdHex(this.me?.actor?.env_id);
  }

  private endSession = async (logoutCustomUrl?: string): Promise<boolean> => {
    this.isConnected = false;
    let logoutUrl = logoutCustomUrl;
    if (!logoutUrl) {
      // The session lives on the origin that answered its login; a session set some other
      // way (no login answer seen) is on the environment's embed origin.
      const embedOrigin = this.sessionOrigin ?? embedOriginFor(this.permitApiUrl, this.me?.actor?.env_id);
      if (embedOrigin === undefined) {
        // No Elements session known in this page (none logged in here, a page reload, a
        // supportsPrivateBrowser login): nothing to end without logoutCustomUrl.
        this.me = undefined;
        return false;
      }
      logoutUrl = `${embedOrigin}/v2/auth/logout`;
    }
    this.me = undefined;
    this.sessionOrigin = undefined;
    // add iframe to logout
    const iframe = document.createElement('iframe');
    iframe.id = 'permit-iframe-logout';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.position = 'absolute';
    iframe.src = logoutUrl;
    iframe.style.top = '-10px';
    iframe.style.left = '-10px';
    // Resolve once the logout request has loaded, or after LOGOUT_WAIT_MS. The iframe is
    // removed only once it has loaded: removing it earlier would cancel the request.
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), LOGOUT_WAIT_MS);
      iframe.onload = () => {
        clearTimeout(timer);
        iframe.remove();
        resolve(true);
      };
      try {
        document.body.appendChild(iframe);
      } catch (error) {
        clearTimeout(timer);
        throw error;
      }
    });
  }

  help = () => {
    const helpMessage = `Permit elements lets you display Permit elements in your application
      To use this feature you need to follow these instructions: https://permit.io/docs/elements`;
    console.info(helpMessage);
    return helpMessage;
  }
}
