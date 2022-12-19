
export enum LoginMethod {
  bearer = 'bearer',
  header = 'header',
  cookie = 'cookie',
}
export interface LoginInterface {
  loginUrl: string
  loginMethod: LoginMethod
  tenant: string
  token?: string
  headers?: Record<string, string>
}
export interface Elements {
  login: ({}: LoginInterface) => Promise<boolean>
  logout: (logoutUrl: string) => Promise<boolean>
}

export interface Permit {
  elements: Elements
}
