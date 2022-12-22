import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { LoginInterface, LoginMethod } from './types'

const PERMIT_URL = new RegExp('^https:\/\/[a-z0-9]{32}\.embed\.api(\.stg|)\.permit\.io$');
const PERMIT_LOCAL_URL = new RegExp('http:\/\/localhost:8000');

export class PermitElements {
  config?: AxiosRequestConfig;
  axios: AxiosInstance;
  isConnected: boolean;
  me?: any;
  isDev = window._env_.IS_PROD == false;
  constructor() {
    this.config = {}
    this.isConnected = false;
    this.axios = axios.create({ withCredentials: true });
  }

  loginWithAjax = async ({
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
        return response.data.url;
      })
      .catch((error) => {
        this.isConnected = false;
        console.error(error);
        throw new Error('Error while trying to login, make sure that you\'ve created a login as route in your application and passed the right credentials');
      });
  }


  login = async ({
    loginUrl,
    loginMethod = LoginMethod.cookie,
    tenant,
    token,
    headers,
  }: LoginInterface): Promise<boolean> => {
    if (this.isConnected) {
      console.info('Already connected, if you want to connect to another tenant, please logout first');
      return Promise.resolve(true);
    }
    // check if the iframe is already created
    const checkIframe = document.getElementById('permit-iframe');
    if (checkIframe) {
      return Promise.resolve(false);
    }
    let iframeUrl = '';
    if (loginMethod !== LoginMethod.cookie) {
      iframeUrl = await this.loginWithAjax({ loginUrl, loginMethod, tenant, token, headers });
    } else{
      iframeUrl = `${loginUrl}?tenant=${tenant}`
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'permit-iframe';
    iframe.style.display = 'hidden';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.position = 'absolute';
    iframe.style.top = '-10px';
    iframe.style.left = '-10px';
    iframe.src = iframeUrl;
    const promise = new Promise((resolve, reject) => {
      window.addEventListener("message", (msg) => {
        const urlRegex = this.isDev ? PERMIT_LOCAL_URL : PERMIT_URL;
        if (msg.origin.match(urlRegex)) {
          this.isConnected = true;
          this.me = msg.data.me;
          resolve(true);
        }
      }, false);
      document.body.appendChild(iframe);
      this.isConnected = true;
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 3000);
    });

  }

  logout = async (logoutCustomUrl?: string) => {
    const logoutUrl = logoutCustomUrl || `https://${this.me.actor.env_id}.embed.api.stg.permit.io/v2/auth/logout`;
    return this.axios.post(logoutUrl)
      .then((response) => {
        this.isConnected = false
        return true
      })
      .catch((error) => {
        console.error(error)
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
