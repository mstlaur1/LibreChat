import { GraphEvents } from '../common/enum.mjs';
import { createContentAggregator, ChatModelStreamHandler } from '../stream.mjs';
import { ModelEndHandler, ToolEndHandler } from '../events.mjs';

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
    const { contentParts, aggregateContent } = createContentAggregator();
    // Create the handlers object
    const handlers = {
        [GraphEvents.TOOL_END]: new ToolEndHandler(),
        [GraphEvents.CHAT_MODEL_END]: new ModelEndHandler(),
        [GraphEvents.CHAT_MODEL_STREAM]: new ChatModelStreamHandler(),
        [GraphEvents.ON_RUN_STEP]: {
            handle: (event, data) => {
                aggregateContent({ event, data: data });
                callbacks?.onRunStep?.(event, data);
            },
        },
        [GraphEvents.ON_RUN_STEP_COMPLETED]: {
            handle: (event, data) => {
                aggregateContent({
                    event,
                    data: data,
                });
                callbacks?.onRunStepCompleted?.(event, data);
            },
        },
        [GraphEvents.ON_RUN_STEP_DELTA]: {
            handle: (event, data) => {
                aggregateContent({ event, data: data });
                callbacks?.onRunStepDelta?.(event, data);
            },
        },
        [GraphEvents.ON_MESSAGE_DELTA]: {
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

export { createHandlers };
//# sourceMappingURL=handlers.mjs.map
