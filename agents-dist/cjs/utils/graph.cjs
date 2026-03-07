'use strict';

const resetIfNotEmpty = (value, resetValue) => {
    if (Array.isArray(value)) {
        return value.length > 0 ? resetValue : value;
    }
    if (value instanceof Set || value instanceof Map) {
        return value.size > 0 ? resetValue : value;
    }
    return value !== undefined ? resetValue : value;
};
const joinKeys = (args) => args.join('_');

exports.joinKeys = joinKeys;
exports.resetIfNotEmpty = resetIfNotEmpty;
//# sourceMappingURL=graph.cjs.map
