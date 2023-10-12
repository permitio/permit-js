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
  if (typeof window === 'undefined') {
    console.warn("Running Permit outside of a browser environment. \nConsider using permitio node package or importing only the parts you need");
    return new Permit();
  }
  else
    return window._permit || (window._permit = new Permit());
}


export const permit = permit_init();

