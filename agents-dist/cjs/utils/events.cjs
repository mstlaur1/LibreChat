'use strict';

var dispatch = require('@langchain/core/callbacks/dispatch');

/* eslint-disable no-console */
// src/utils/events.ts
/**
 * Safely dispatches a custom event and properly awaits it to avoid
 * race conditions where events are dispatched after run cleanup.
 */
async function safeDispatchCustomEvent(event, payload, config) {
    try {
        await dispatch.dispatchCustomEvent(event, payload, config);
    }
    catch (e) {
        // Check if this is the known EventStreamCallbackHandler error
        if (e instanceof Error &&
            e.message.includes('handleCustomEvent: Run ID') &&
            e.message.includes('not found in run map')) {
            // Suppress this specific error - it's expected during parallel execution
            // when EventStreamCallbackHandler loses track of run IDs
            // console.debug('Suppressed error dispatching custom event:', e);
            return;
        }
        // Log other errors
        console.error('Error dispatching custom event:', e);
    }
}

exports.safeDispatchCustomEvent = safeDispatchCustomEvent;
//# sourceMappingURL=events.cjs.map
