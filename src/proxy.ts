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
    post({url, data, headers}: postInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.post(fullUrl, data, {headers});
    }
    put({url, data, headers}: putInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.put(fullUrl, data, {headers});
    }
    delete({url, data, headers}: deleteInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.delete(fullUrl, {data, headers});
    }
    patch({url, data, headers}: patchInterface) {
        const fullUrl = `${this.proxyUrl}${url}`;   
        return axios.patch(fullUrl, data, {headers});
    }
}

export class Proxy {
    constructor() {
    }
    getProxy = ({proxyId, token}: FoAzInterface) : PermitProxy => {
        return new PermitProxy({proxyId, token});
    }
}


