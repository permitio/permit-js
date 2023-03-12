
export enum LoginMethod {
  bearer = 'bearer',
  header = 'header',
  cookie = 'cookie',
  serverless = 'serverless',
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
export interface Elements {
  login: ({}: LoginInterface) => Promise<boolean>
  logout: (logoutUrl?: string) => Promise<boolean>
}

export interface Permit {
  elements: Elements
}

declare global {
  interface Window { _permit: Permit;}
}