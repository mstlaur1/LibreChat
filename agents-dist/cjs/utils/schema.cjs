'use strict';

var zodToJsonSchema = require('zod-to-json-schema');

// src/utils/schema.ts
/** Checks if a schema is a Zod schema by looking for the _def property */
function isZodSchema(schema) {
    return (schema != null && typeof schema === 'object' && '_def' in schema);
}
/**
 * Converts a schema to JSON schema format.
 * Handles both Zod schemas (converts) and JSON schemas (passthrough).
 */
function toJsonSchema(schema, name, description) {
    if (isZodSchema(schema)) {
        const zodSchema = schema;
        const described = description != null && description !== ''
            ? zodSchema.describe(description)
            : schema;
        return zodToJsonSchema.zodToJsonSchema(described, name ?? '');
    }
    return schema;
}

exports.isZodSchema = isZodSchema;
exports.toJsonSchema = toJsonSchema;
//# sourceMappingURL=schema.cjs.map
