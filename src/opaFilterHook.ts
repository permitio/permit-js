export interface AttributeFilterRule {
  resource: string;
  attributes: string[];
}

export function evaluateAttributeFilter(rule: AttributeFilterRule, context: Record<string, any>): boolean {
  return rule.attributes.every(attr => attr in context);
}
