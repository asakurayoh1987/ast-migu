const debug = require('debug')('migu');
const types = require('@babel/types');

const generator = require('@babel/generator').default;

/**
 * @type {import("@babel/traverse").TraverseOptions['VariableDeclarator']}
 */
const VariableDeclarator = {
  enter: path => {
    debug(`VariableDeclarator path: ${path.toString()}`);
    // 获取变量名和其初始化值
    const {
      id: { name },
      init,
    } = path.node;

    // 根据变量名查找binding
    const binding = path.scope.getBinding(name);

    // 如果初始化的值是字面量，并且未被修改过
    if (types.isLiteral(init) && binding.constant) {
      // 进行字面量的替换，遍历所有被引用的地方，将节点替换为一个字面量节点
      // 这里的types.valueToNode是babel提供的工具函数，用来根据具体的值创建对应的节点
      for (let referPath of binding.referencePaths) {
        referPath.replaceWith(types.valueToNode(init.value));
      }

      // 全部替换之后则可以将变量声明给移除了，可选
      path.remove();
    }

    // 全局函数声明
    if (types.isFunctionExpression(init) && path.scope.uid === 0) {
      try {
        // 拿到函数的字符串形式，复用eval来进行全局声明，后续的操作中会用到
        eval(path.toString());
        path.remove();
      } catch (err) {
        debug(err);
      }
    }
  },
};

/**
 * @type {import("@babel/traverse").TraverseOptions['BinaryExpression']}
 */
const BinaryExpression = {
  exit: path => {
    debug(`BinaryExpression path: ${path.toString()}`);
    // 左值、右值、运算符
    const { left, right, operator } = path.node;
    // 如果左值与右值都是字面量，则进行处理（这里先不考虑全量变量的场景）
    if (types.isLiteral(left) && types.isLiteral(right)) {
      let result = null;
      const leftValue = left.value;
      const rightValue = right.value;

      switch (operator) {
        case '+':
          result = leftValue + rightValue;
          break;
        case '-':
          result = leftValue - rightValue;
          break;
        case '*':
          result = leftValue * rightValue;
          break;
        case '/':
          result = leftValue / rightValue;
          break;
        case '<<':
          result = leftValue << rightValue;
          break;
        case '==':
          result = leftValue == rightValue;
          break;
        case '===':
          result = leftValue === rightValue;
          break;
        case '!=':
          result = leftValue != rightValue;
          break;
        case '!==':
          result = leftValue !== rightValue;
          break;
        default:
          throw new Error(
            `unhandled operator(${operator}) in BinaryExpression(${path.toString()})!`
          );
      }

      // 使用字面量运算结果替换原节点
      path.replaceWith(types.valueToNode(result));
    }
  },
};

/**
 * @type {import("@babel/traverse").TraverseOptions['CallExpression']}
 */
const CallExpression = {
  exit: path => {
    debug(`CallExpression path: ${path.toString()}`);
    // 获取被调用方以及参数
    const { callee, arguments: args } = path.node;
    let result = null;

    // 如果callee是一个标识符，说明它是一个函数
    if (types.isIdentifier(callee)) {
      // 获取标识符的变量名
      const { name } = callee;
      // 如果在全局环境已经存在，则直接
      if (name in global) {
        result = evalExp(path.toString());
      } else {
        // 如果是代码中的标识符，比如新定义的函数
        const binding = path.scope.getBinding(name);
        if (binding) {
          // 声明函数
          evalExp(binding.path.toString());
          // 执行函数并用其结果值替换节点
          result = evalExp(path.toString());
        }
      }
    }

    // 如果callee是一个MemberExpression
    if (types.isMemberExpression(callee)) {
      // 获取对象及所访问的属性
      const { object, property } = callee;
      // 比如："1|2|0|3|5|4".split('|')
      if (types.isLiteral(object)) {
        result = evalExp(path.toString());
      }

      // 对象是一个标识符
      if (types.isIdentifier(object)) {
        const { name } = object;
        // 全局对象
        if (name in global) {
          result = evalExp(path.toString());
        } else {
          // 如果是代码中的标识符，比如：_l1$1L1lL.oQuG36
          const binding = path.scope.getBinding(name);
          if (binding) {
            // 这里目的是用来定制处理sdk中的工具函数，用来将执行结果替换一个二元表达式，并作为if语句中的条件部分
            if (types.isVariableDeclarator(binding.path)) {
              if (types.isObjectExpression(binding.path.node.init)) {
                binding.path.traverse({
                  ObjectProperty(propPath) {
                    if (propPath.node.key.name !== property.name) {
                      return;
                    }
                    propPath.traverse({
                      BinaryExpression(returnPath) {
                        if (types.isReturnStatement(returnPath.parentPath)) {
                          const { operator } = returnPath.node;
                          result = types.BinaryExpression(
                            operator,
                            args[0],
                            args[1]
                          );
                        }
                      },
                    });
                  },
                });
              }
            }
          }
        }
      }
    }

    if (result === null) {
      return;
    }

    path.replaceWith(types.isNode(result) ? result : types.valueToNode(result));
  },
};

/**
 * 对eval的简单封装
 */
function evalExp(exp) {
  if (!isIdempotent(exp) || keepRaw(exp)) {
    return null;
  }
  try {
    return eval(exp);
  } catch (err) {
    debug(err);
    return null;
  }
}

/**
 * 判断函数是否是幂等的
 */
function isIdempotent(funStr) {
  return !/Date|Math\.random/.test(funStr);
}

/**
 * 判断函数是否要保持原表达式的形式，而不是获取调用的结果
 */
function keepRaw(funStr) {
  return /Array|Error|setTimeout|setInterval|JSON\.stringify|Object\.assign|console\.log/.test(
    funStr
  );
}

/**
 * @type {import("@babel/traverse").TraverseOptions['ForStatement']}
 */
const ForStatement = {
  exit: path => {
    debug(`ForStatement path: ${path.toString()}`);
    const { init, body } = path.node;
    if (types.isBlockStatement(body) && types.isSwitchStatement(body.body[0])) {
      try {
        // 这里偷了个懒，将节点转成代码后，通过eval来拿到变量
        eval(generator(init).code);
        let statementStr = [];
        const { discriminant, cases } = body.body[0];
        // 同上，通过eval拿到当前的case的值
        let caseNo = eval(generator(discriminant).code);
        while (caseNo) {
          const caseExpression = cases.find(
            c => types.isLiteral(c.test) && c.test.value === caseNo
          );
          if (!caseExpression) {
            continue;
          }
          caseExpression.consequent
            // FIXME: 这里偷懒了，应该是获取第一条continue之前的代码，只不过源码比较规范，可不处理
            .filter(item => !types.isContinueStatement(item))
            .forEach(item => {
              // 将得到的语句按序放入数组
              statementStr.push(item);
            });

          caseNo = eval(generator(discriminant).code);
        }

        path.replaceWithMultiple(statementStr);
      } catch {
        return;
      }
    }
  },
};

module.exports = {
  VariableDeclarator,
  BinaryExpression,
  CallExpression,
  ForStatement,
};
