module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(ky)/)',  // Tell Jest to transform ky using Babel
  ],
  moduleFileExtensions: ['ts', 'js'],
  testEnvironment: 'node',
};