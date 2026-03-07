import { nanoid } from 'nanoid';

// src/stream.ts
const getMessageId = (stepKey, graph, returnExistingId = false) => {
    const messageId = graph.messageIdsByStepKey.get(stepKey);
    if (messageId != null && messageId) {
        return returnExistingId ? messageId : undefined;
    }
    const prelimMessageId = graph.prelimMessageIdsByStepKey.get(stepKey);
    if (prelimMessageId != null && prelimMessageId) {
        graph.prelimMessageIdsByStepKey.delete(stepKey);
        graph.messageIdsByStepKey.set(stepKey, prelimMessageId);
        return prelimMessageId;
    }
    const message_id = `msg_${nanoid()}`;
    graph.messageIdsByStepKey.set(stepKey, message_id);
    return message_id;
};

export { getMessageId };
//# sourceMappingURL=ids.mjs.map
