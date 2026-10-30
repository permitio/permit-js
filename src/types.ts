
export enum LoginMethod {
  bearer = 'bearer',
  header = 'header',
  cookie = 'cookie',
  frontendOnly = 'frontendOnly',
  supportsPrivateBrowser = 'supportsPrivateBrowser',
}

export interface LoginInterface {
  loginMethod: LoginMethod
  loginUrl?: string
  tenant?: string
  token?: string
  headers?: Record<string, string>
  userJwt?: string
  envId?: string
  userKeyClaim?: string
  /**
   * The deployment's API URL (http or https). Login answers are accepted from its embed
   * origin (`<env id>.embed.<its host>`, or the API URL's own origin on localhost or an IP
   * address), so a deployment other than Permit SaaS must pass it. A path on the page's
   * origin (e.g. `/permit-api`, a same-origin proxy for a frontendOnly login) is accepted
   * too; success answers are then taken from Permit SaaS origins only.
   */
  permitApiUrl?: string
  /**
   * More origins a login error answer is accepted from, e.g. the origin of a self-hosted
   * deployment's login error page. Each entry must be an http(s) URL; only its origin is
   * compared. A success answer is never taken from them.
   */
  trustedOrigins?: readonly string[]
  elementIframeUrl?: string
}

export interface ApproveInterface {
  inviteCode: string
  email: string
  token: string
  envId: string
  user_key_claim?: string
  attributes?: Object
  /**
   * The deployment's API URL (http or https). Defaults to that of the deployment that
   * answered the last successful login, or Permit SaaS. approve() does not wait for a login
   * still running, so pass it when a login may not have finished.
   */
  permitApiUrl?: string
}

export interface FoAzInterface {
  proxyId: string
  token: string
}

export interface Elements {
  /**
   * Runs after any login() or logout() still running. Resolves true once connected or
   * already connected; a supportsPrivateBrowser login resolves true once its login request
   * returns, and then hands the token to the element iframe (isConnected stays false).
   * Rejects with the error page's message (a string) on an error answer, and with an Error
   * when an option the login method needs is missing, permitApiUrl is neither an http(s)
   * URL nor a path on the page's origin, a trustedOrigins entry is not an http(s) URL, the
   * login request fails or takes over 10 seconds, the login iframe can't be added, or it
   * gets no answer within 3 seconds of being added (e.g. a deployment other than Permit SaaS
   * did not pass permitApiUrl).
   */
  login: ({}: LoginInterface) => Promise<boolean>
  approve: ({inviteCode, email, token, envId, attributes}: ApproveInterface) => Promise<any>
  /**
   * Runs after any login() or logout() still running. Resolves true once the logout URL
   * (logoutUrl, or that of the session this page logged in) has loaded or after 10 seconds,
   * or false when no session is known here to end. Rejects if its iframe can't be added.
   */
  logout: (logoutUrl?: string) => Promise<boolean>
}

export interface Proxy {
  getProxy: ({}: FoAzInterface) => PermitProxy
}

export interface getInterface {
  url: string;
  params?: any;
  headers?: any;
}

export interface postInterface {
  url: string;
  data?: any;
  params?: any;
  headers?: any;
}

export interface putInterface {
  url: string;
  data?: any;
  params?: any;
  headers?: any;
}

export interface deleteInterface {
  url: string;
  data?: any;
  params?: any;
  headers?: any;
}

export interface patchInterface {
  url: string;
  data?: any;
  params?: any;
  headers?: any;
}


export interface PermitProxy {
  get: ({}: getInterface) => Promise<any>
  post: ({}: postInterface) => Promise<any>
  put: ({}: putInterface) => Promise<any>
  delete: ({}: deleteInterface) => Promise<any>
  patch: ({}: patchInterface) => Promise<any>
}

export interface Permit {
  elements: Elements
  proxy: Proxy
}

declare global {
  interface Window { _permit: Permit;}
}