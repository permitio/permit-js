import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { LoginInterface, LoginMethod } from './types'

export class PermitElements {
  config?: AxiosRequestConfig;
  axios: AxiosInstance;
  isConnected: boolean;

  constructor() {
    this.config = {}
    this.axios = axios.create({ withCredentials: true });
  }
  login = async ({
    loginUrl,
    loginMethod,
    tenant,
    token,
    headers,
  }: LoginInterface) => {
    if (loginMethod === LoginMethod.bearer) {
      if (token === undefined) {
        throw new Error('When using bearer login, token must be defined')
      }
      this.config = {
        ...this.config,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
    if (loginMethod === LoginMethod.header) {
      if (headers === undefined) {
        throw new Error('When using header login, headers must be defined')
      }
      this.config = { ...this.config, headers }
    }

    return this.axios
      .post(loginUrl, { tenant: tenant }, this.config)
      .then((response) => {
        console.info(response);
        const url = String(response.data.url);
        return this.axios.get(url, this.config).then(function (response) {
          console.info(response);
          this.isConnected = true;
          return this.isConnected;
        }).catch((error) => {
          console.error(error);
          this.isConnected = false;
          return this.isConnected;
        });
      })
      .catch((error) => {
        console.error(error);
        this.isConnected = false;
        return this.isConnected;
      });
  }
  logout = async (logoutUrl: string) => {
    if (!this.isConnected) {
      this.help();
      return false;
    }
    return this.axios.get(logoutUrl)
      .then((response) => {
        console.log(response)
        return true
      })
      .catch((error) => {
        console.log(error)
        return false
      })
  }

  help = () => {
    const helpMessage = `Permit elements lets you display Permit elements in your application
      To use this feature you need to follow these instructions: https://permit.io/docs/elements`;
    console.info(helpMessage);
    return helpMessage;
  }
}
