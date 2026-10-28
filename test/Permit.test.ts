import permit, { ApproveError } from "../src/index"
import { ApproveError as ElementsApproveError } from "../src/elements"
test('Permit exist', () => {
  expect(permit).toBeInstanceOf(Object)
})

test('Permit has elements', () => {
  expect(permit.elements).toBeInstanceOf(Object)
})

test('Permit elements has login', () => {
  expect(permit.elements.login).toBeInstanceOf(Function)
})

test('Permit elements has logout', () => {
  expect(permit.elements.logout).toBeInstanceOf(Function)
}
)

test('The entry point exports ApproveError', () => {
  expect(ApproveError).toBe(ElementsApproveError)
})
