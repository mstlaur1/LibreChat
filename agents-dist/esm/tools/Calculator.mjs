import { Tool } from '@langchain/core/tools';
import * as math from 'mathjs';

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
class Calculator extends Tool {
    static lc_name() {
        return 'Calculator';
    }
    get lc_namespace() {
        return [...super.lc_namespace, 'calculator'];
    }
    name = CalculatorToolName;
    async _call(input) {
        try {
            return math.evaluate(input).toString();
        }
        catch {
            return 'I don\'t know how to do that.';
        }
    }
    description = CalculatorToolDescription;
}

export { Calculator, CalculatorSchema, CalculatorToolDefinition, CalculatorToolDescription, CalculatorToolName };
//# sourceMappingURL=Calculator.mjs.map
