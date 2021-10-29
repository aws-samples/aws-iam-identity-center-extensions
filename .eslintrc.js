module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
  },
  extends: ['airbnb-base'],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'no-console': 'off',
    'import/no-unresolved': 'off', // needed for ignoring dependencies that we manage through lambda layers
    'no-useless-escape': 'off',
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
    'import/no-extraneous-dependencies': 'off', // needed for ignoring dependencies that we manage through lambda layers
    'func-names': 'off', // to override the async await generators being generated for pagination
    eqeqeq: ['error', 'smart'],
  },
};
