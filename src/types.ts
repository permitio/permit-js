
export enum LoginMethod {
  bearer = 'bearer',
  header = 'header',
  cookie = 'cookie',
  frontendOnly = 'frontendOnly',
}

export interface LoginInterface {
  loginMethod: LoginMethod
  loginUrl?: string
  tenant?: string
  token?: string
  headers?: Record<string, string>
  userJwt?: string
  envId?: string
}

export interface FoAzInterface {
  proxyId: string
  token: string
}

export interface Elements {
  login: ({}: LoginInterface) => Promise<boolean>
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