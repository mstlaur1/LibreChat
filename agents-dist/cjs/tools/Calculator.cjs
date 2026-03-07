'use strict';

var tools = require('@langchain/core/tools');
var math = require('mathjs');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var math__namespace = /*#__PURE__*/_interopNamespaceDefault(math);

const CalculatorToolName = 'calculator';
const CalculatorToolDescription = 'Useful for getting the result of a math expression. The input to this tool should be a valid mathematical expression that could be executed by a simple calculator.';
const CalculatorSchema = {
    type: 'object',
    properties: {
        input: {
            type: 'string',
            description: 'A valid mathematical expression to evaluate',
        },
    },
    required: ['input'],
};
const CalculatorToolDefinition = {
    name: CalculatorToolName,
    description: CalculatorToolDescription,
    schema: CalculatorSchema,
};
class Calculator extends tools.Tool {
    static lc_name() {
        return 'Calculator';
    }
    get lc_namespace() {
        return [...super.lc_namespace, 'calculator'];
    }
    name = CalculatorToolName;
    async _call(input) {
        try {
            return math__namespace.evaluate(input).toString();
        }
        catch {
            return 'I don\'t know how to do that.';
        }
    }
    description = CalculatorToolDescription;
}

exports.Calculator = Calculator;
exports.CalculatorSchema = CalculatorSchema;
exports.CalculatorToolDefinition = CalculatorToolDefinition;
exports.CalculatorToolDescription = CalculatorToolDescription;
exports.CalculatorToolName = CalculatorToolName;
//# sourceMappingURL=Calculator.cjs.map
