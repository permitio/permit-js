
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
  // The deployment's API URL (http or https). Login answers are accepted from its embed
  // origin (`<env id>.embed.<its host>`, or the API URL's own origin on localhost or an IP
  // address), so a deployment other than Permit SaaS must pass it.
  permitApiUrl?: string
  // More origins a login error answer is accepted from, exactly as `event.origin` spells
  // them, e.g. the origin of a self-hosted deployment's login error page. A success answer
  // is never taken from them.
  trustedOrigins?: string[]
  elementIframeUrl?: string
}

export interface ApproveInterface {
  inviteCode: string
  email: string
  token: string
  envId: string
  user_key_claim?: string
  attributes?: Object
  // The deployment's API URL; defaults to that of the last login, or Permit SaaS.
  permitApiUrl?: string
}

export interface FoAzInterface {
  proxyId: string
  token: string
}

export interface Elements {
  // Resolves true once connected (or already connected). Rejects on an error answer, or
  // when the login gets no answer within 3 seconds, e.g. because a deployment other than
  // Permit SaaS did not pass permitApiUrl.
  login: ({}: LoginInterface) => Promise<boolean>
  approve: ({inviteCode, email, token, envId, attributes}: ApproveInterface) => Promise<any>
  // Resolves true once the logout URL (logoutUrl, or that of the session this page logged
  // in) has loaded or after 10 seconds, or false when no session is known here to end.
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