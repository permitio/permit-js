import { PermitElements } from "./elements";
import { Elements } from "./types";

export class Permit {
  elements: Elements;

  constructor() {
    this.elements = new PermitElements();
  }
}
