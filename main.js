const parse = require('@babel/parser').parse;
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const { resolve } = require('node:path');
const { readFileSync, outputFileSync } = require('fs-extra');

const {
  VariableDeclarator,
  BinaryExpression,
  CallExpression,
  ForStatement,
} = require('./traverse/index.js');

const source = readFileSync(resolve(__dirname, './js-sdk/migus.js'), {
  encoding: 'utf8',
});

const ast = parse(source);

traverse(ast, {
  VariableDeclarator,
  BinaryExpression,
  CallExpression,
  ForStatement,
});

let { code } = generator(ast);

code = code.replaceAll(/(\\u[\d\w]+)+/g, m => {
  return eval(`'${m}'`)
});

outputFileSync(resolve(__dirname, './dist/migu.js'), code, {
  encoding: 'utf8',
});
