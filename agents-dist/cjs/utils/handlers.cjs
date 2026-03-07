'use strict';

var _enum = require('../common/enum.cjs');
var stream = require('../stream.cjs');
var events = require('../events.cjs');

/**
 * Multi-Agent Handler Utilities
 *
 * Provides a simple helper to create handlers with content aggregation for multi-agent scripts.
 *
 * Usage:
 * ```typescript
 * const { contentParts, aggregateContent, handlers } = createHandlers();
 *
 * // With callbacks
 * const { contentParts, aggregateContent, handlers } = createHandlers({
 *   onRunStep: (event, data) => console.log('Step:', data),
 *   onRunStepCompleted: (event, data) => console.log('Completed:', data)
 * });
 * ```
 */
/**
 * Creates handlers with content aggregation for multi-agent scripts
 */
function createHandlers(callbacks) {
    // Set up content aggregator
    const { contentParts, aggregateContent } = stream.createContentAggregator();
    // Create the handlers object
    const handlers = {
        [_enum.GraphEvents.TOOL_END]: new events.ToolEndHandler(),
        [_enum.GraphEvents.CHAT_MODEL_END]: new events.ModelEndHandler(),
        [_enum.GraphEvents.CHAT_MODEL_STREAM]: new stream.ChatModelStreamHandler(),
        [_enum.GraphEvents.ON_RUN_STEP]: {
            handle: (event, data) => {
                aggregateContent({ event, data: data });
                callbacks?.onRunStep?.(event, data);
            },
        },
        [_enum.GraphEvents.ON_RUN_STEP_COMPLETED]: {
            handle: (event, data) => {
                aggregateContent({
                    event,
                    data: data,
                });
                callbacks?.onRunStepCompleted?.(event, data);
            },
        },
        [_enum.GraphEvents.ON_RUN_STEP_DELTA]: {
            handle: (event, data) => {
                aggregateContent({ event, data: data });
                callbacks?.onRunStepDelta?.(event, data);
            },
        },
        [_enum.GraphEvents.ON_MESSAGE_DELTA]: {
            handle: (event, data) => {
                aggregateContent({ event, data: data });
                callbacks?.onMessageDelta?.(event, data);
            },
        },
    };
    return {
        contentParts,
        aggregateContent,
        handlers,
    };
}

exports.createHandlers = createHandlers;
//# sourceMappingURL=handlers.cjs.map
