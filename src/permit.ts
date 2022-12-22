import { PermitElements } from "./elements";
import { Elements } from "./types";

class Permit {
  elements: Elements;

  constructor() {
    this.elements = new PermitElements();
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

