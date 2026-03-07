'use strict';

function handleToolChoice(toolChoice) {
    if (toolChoice == null) {
        return undefined;
    }
    else if (toolChoice === 'any') {
        return {
            type: 'any',
        };
    }
    else if (toolChoice === 'auto') {
        return {
            type: 'auto',
        };
    }
    else if (typeof toolChoice === 'string') {
        return {
            type: 'tool',
            name: toolChoice,
        };
    }
    else {
        return toolChoice;
    }
}

exports.handleToolChoice = handleToolChoice;
//# sourceMappingURL=tools.cjs.map
