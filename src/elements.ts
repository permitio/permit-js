import ky from 'ky';
import { ApproveInterface, LoginInterface, LoginMethod } from './types'
import {sendTokenToIframe} from "./sendToken";

// The embed origins Permit SaaS serves Elements from.
export const PERMIT_URL = /^https:\/\/([a-z0-9]{32}\.)?embed(\.api)?(\.stg)?\.permit\.io$/;
const PERMIT_API_URL = "https://api.permit.io";
// How long the login and logout iframes live; no answer can arrive once one is removed.
const IFRAME_LIFETIME_MS = 3000;
const ENV_ID = /^[0-9a-f]{32}$/;

/** An environment id as the embed host spells it (32 hex digits), or undefined. */
function envIdHex(envId: unknown): string | undefined {
  const hex = String(envId ?? '').replace(/-/g, '');
  return ENV_ID.test(hex) ? hex : undefined;
}

/**
 * Whether `origin` serves Permit Elements: a Permit SaaS embed origin, or
 * `<scheme>://<env id>.embed.<host of permitApiUrl>` for a deployment with its own API URL.
 */
export function isPermitEmbedOrigin(origin: string, permitApiUrl: string = PERMIT_API_URL): boolean {
  if (PERMIT_URL.test(origin)) {
    return true;
  }
  let api: URL;
  let from: URL;
  try {
    api = new URL(permitApiUrl);
    from = new URL(origin);
  } catch {
    return false;
  }
  const [envId, embed, ...apiHost] = from.hostname.split('.');
  return from.protocol === api.protocol && from.port === api.port
    && envIdHex(envId) === envId && embed === 'embed' && apiHost.join('.') === api.hostname;
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
  // The API URL of the last login, so logout() and approve() reach the same deployment.
  permitApiUrl = PERMIT_API_URL;
  private loginInFlight?: Promise<boolean>;
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

    return ky.post(loginUrl, { json: postData, ...this.config })
      .json()
      .then((data: any) => {
        if (loginMethod === LoginMethod.frontendOnly) {
          return data.redirect_url;
        } else {
          return data.url;
        }
      })
      .catch((error) => {
        this.isConnected = false;
        console.error(error);
        throw new Error('Error while trying to login, make sure that you\'ve created a login as route in your application and passed the right credentials');
      });
  }

  login = (args: LoginInterface): Promise<boolean> => {
    // A call while a login is in flight joins it instead of starting another.
    if (this.loginInFlight === undefined) {
      const done = () => {
        this.loginInFlight = undefined;
      };
      this.loginInFlight = this.startLogin(args).then(
        (connected) => {
          done();
          return connected;
        },
        (error) => {
          done();
          throw error;
        },
      );
    }
    return this.loginInFlight;
  }

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
  }: LoginInterface): Promise<boolean> => {
    if (this.isConnected) {
      console.info('Already connected, if you want to connect to another tenant, please logout first');
      return Promise.resolve(true);
    }
    this.permitApiUrl = permitApiUrl;
    // check if the iframe is already created
    const checkIframe = document.getElementById('permit-iframe');
    if (checkIframe) {
      return Promise.resolve(false);
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
        if (loginUrl.includes('?')) {
          iframeUrl = `${loginUrl}&tenant=${tenant}`;
        } else {
          iframeUrl = `${loginUrl}?tenant=${tenant}`;
        }
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
      const stopListening = () => window.removeEventListener("message", onMessage, false);
      const onMessage = (msg: MessageEvent) => {
        // Only our login iframe answers, and only from a Permit embed origin.
        if (msg.source !== iframe.contentWindow || !isPermitEmbedOrigin(msg.origin, permitApiUrl)) {
          return;
        }
        if (msg.data?.success === true) {
          stopListening();
          this.isConnected = true;
          this.me = msg.data.me;
          resolve(true);
        } else if (msg.data?.success === false) {
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
      // No answer can come once the iframe is gone. After an answer, reject() is a no-op.
      setTimeout(() => {
        iframe.remove();
        stopListening();
        reject('Timed out waiting for the Permit Elements login to answer');
      }, IFRAME_LIFETIME_MS);
    });

  }

  approve = async ({inviteCode, email, token, envId, user_key_claim="sub", attributes = {}}: ApproveInterface) => {
    const cleanEnvId = envIdHex(envId);
    if (cleanEnvId === undefined) {
      throw new Error('approve: envId must be a Permit environment id');
    }
    const approveUrl = `${this.embedOrigin(cleanEnvId)}/v2/auth/${cleanEnvId}/user_invites/${encodeURIComponent(inviteCode)}/approve`;
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


  logout = async (logoutCustomUrl?: string) => {
    this.isConnected = false;
    let logoutUrl = logoutCustomUrl;
    if (!logoutUrl) {
      const envId = envIdHex(this.me?.actor?.env_id);
      if (envId === undefined) {
        // No Elements login session to end here: a supportsPrivateBrowser login has no `me`.
        return true;
      }
      logoutUrl = `${this.embedOrigin(envId)}/v2/auth/logout`;
    }
    this.me = undefined;
    // add iframe to logout
    const iframe = document.createElement('iframe');
    iframe.id = 'permit-iframe-logout';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.position = 'absolute';
    iframe.src = logoutUrl;
    iframe.style.top = '-10px';
    iframe.style.left = '-10px';
    // Resolve once the logout request has completed, so that a login right after it
    // is not logged out by it.
    return new Promise<boolean>((resolve) => {
      const done = () => {
        iframe.remove();
        resolve(true);
      };
      iframe.onload = done;
      setTimeout(done, IFRAME_LIFETIME_MS);
      document.body.appendChild(iframe);
    });
  }

  private embedOrigin = (envId: string): string => {
    const api = new URL(this.permitApiUrl);
    return `${api.protocol}//${envId}.embed.${api.host}`;
  }

  help = () => {
    const helpMessage = `Permit elements lets you display Permit elements in your application
      To use this feature you need to follow these instructions: https://permit.io/docs/elements`;
    console.info(helpMessage);
    return helpMessage;
  }
}
