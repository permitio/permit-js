import ky from 'ky';
import { ApproveInterface, LoginInterface, LoginMethod } from './types'
import {sendTokenToIframe} from "./sendToken";

const PERMIT_URL = new RegExp('^https:\/\/([a-z0-9]{32}\.|)embed\(\.api|)(\.stg|)\.permit\.io$');
const PERMIT_LOCAL_URL = new RegExp('http:\/\/localhost:.000');
const PERMIT_API_URL = "https://api.permit.io";
export class PermitElements {
  config?: RequestInit;
  isConnected: boolean;
  me?: any;
  isDev = false;
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

  login = async ({
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
    return new Promise((resolve, reject) => {
      window.addEventListener("message", (msg) => {
        const urlRegex = PERMIT_URL;
        if (msg.origin.match(urlRegex)) {
          if (msg.data.success === true) {
            this.isConnected = true;
            this.me = msg.data.me;
            resolve(true);
          }
          if (msg.data.success === false) {
            this.isConnected = false;
            const errorMsg = decodeURIComponent(msg?.data?.error);
            reject(errorMsg);
          }
        }
      }, false);
      document.body.appendChild(iframe);
      this.isConnected = true;
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 3000);
    });

  }

  approve = async ({inviteCode, email, token, envId, user_key_claim="sub", attributes = {}}: ApproveInterface) => {
    const cleanEnvId = envId.replace(/-/g, '');
    const approveUrl = `https://${cleanEnvId}.embed.api.permit.io/v2/auth/${cleanEnvId}/user_invites/${inviteCode}/approve`;
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
    let logoutUrl = '';
    if (logoutCustomUrl) {
      logoutUrl = logoutCustomUrl;
    } else {
      const cleanEnvId = this.me?.actor?.env_id.replace(/-/g, '');
      logoutUrl = `https://${cleanEnvId}.embed.api.permit.io/v2/auth/logout`;
    }
    // add iframe to logout
    const iframe = document.createElement('iframe');
    iframe.id = 'permit-iframe-logout';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.position = 'absolute';
    iframe.src = logoutUrl;
    iframe.style.top = '-10px';
    iframe.style.left = '-10px';
    document.body.appendChild(iframe);
    this.isConnected = false;
    return Promise.resolve(true);
  }

  help = () => {
    const helpMessage = `Permit elements lets you display Permit elements in your application
      To use this feature you need to follow these instructions: https://permit.io/docs/elements`;
    console.info(helpMessage);
    return helpMessage;
  }
}
