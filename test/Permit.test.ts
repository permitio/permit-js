import { Permit } from '../dist/Permit'
test('Permit exist', () => {
  expect(new Permit()).toBeInstanceOf(Permit)
})

test('Permit has elements', () => {
  expect(new Permit().elements).toBeInstanceOf(Object)
})

test('Permit elements has login', () => {
  expect(new Permit().elements.login).toBeInstanceOf(Function)
})

test('Permit elements has logout', () => {
  expect(new Permit().elements.logout).toBeInstanceOf(Function)
}
)
