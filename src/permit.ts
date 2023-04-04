import { PermitElements } from "./elements";
import { Elements } from "./types";
import { Proxy } from "./proxy";

class Permit {
  elements: Elements;
  proxy: Proxy;

  constructor() {
    this.elements = new PermitElements();
    this.proxy = new Proxy();
  }


}

const permit_init = () => {
  if (window._permit) {
    console.warn("Permit is already initialized");
    return window._permit;
  }
  window._permit = new Permit();
  return window._permit;
}


export const permit = permit_init();

