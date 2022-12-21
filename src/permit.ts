import { PermitElements } from "./elements";
import { Elements } from "./types";

export class Permit {
  elements: Elements;

  constructor({elementsId}: {elementsId?: string}) {
    this.elements = new PermitElements(elementsId);
  }
}
