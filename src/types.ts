
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
  userKeyClaim?: string
  permitApiUrl?: string
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