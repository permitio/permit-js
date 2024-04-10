import { deleteInterface, FoAzInterface, getInterface, patchInterface, postInterface, putInterface } from './types';
import ky from 'ky';


class PermitProxy {
    proxyUrl: string;
    proxyId: string;
    token: string;
    constructor({proxyId, token}: FoAzInterface) {
        this.proxyId = proxyId;
        this.token = token;
        this.proxyUrl = `https://proxy.api.permit.io/proxy/${proxyId}?url=`;
    }
    
    get({url, params, headers}: getInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;
        return ky.get(fullUrl, {searchParams: params, headers});
    }
    post({url, data, headers, params}: postInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return ky.post(fullUrl, {json: data, searchParams: params, headers});
    }
    put({url, data, headers, params}: putInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;
        return ky.put(fullUrl, {json: data, searchParams: params, headers});
    }
    delete({url, data, headers, params}: deleteInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;
        return ky.delete(fullUrl, {json: data, searchParams: params, headers});
    }
    patch({url, data, headers, params}: patchInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;
        return ky.patch(fullUrl, {json: data, searchParams: params, headers});
    }
}

export class Proxy {
    constructor() {
    }
    getProxy = ({proxyId, token}: FoAzInterface) : PermitProxy => {
        return new PermitProxy({proxyId, token});
    }
}


