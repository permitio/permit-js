import { deleteInterface, FoAzInterface, getInterface, patchInterface, postInterface, putInterface } from './types';
import axios from 'axios';



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
        return axios.get(fullUrl, {params, headers});
    }
    post({url, data, headers, params}: postInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.post(fullUrl, data, {params, headers});
    }
    put({url, data, headers, params}: putInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.put(fullUrl, data, {params, headers});
    }
    delete({url, data, headers, params}: deleteInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.delete(fullUrl, {params, data, headers});
    }
    patch({url, data, headers, params}: patchInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.patch(fullUrl, data, {params, headers});
    }
}

export class Proxy {
    constructor() {
    }
    getProxy = ({proxyId, token}: FoAzInterface) : PermitProxy => {
        return new PermitProxy({proxyId, token});
    }
}


