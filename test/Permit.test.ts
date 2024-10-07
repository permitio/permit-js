import permit from "../src/index"
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
