import { nanoid } from 'nanoid';
import { GraphEvents, ContentTypes, StepTypes } from './common/enum.mjs';

const SEPARATORS = [
    '. ',
    '?',
    '!',
    '۔',
    '- ',
    '。',
    '‥',
    ';',
    '¡',
    '¿',
    '\n',
    '```',
];
class SplitStreamHandler {
    inCodeBlock = false;
    inThinkBlock = false;
    accumulate;
    tokens = [];
    lastToken = '';
    reasoningTokens = [];
    currentStepId;
    currentMessageId;
    currentType;
    currentLength = 0;
    reasoningKey = 'reasoning_content';
    currentIndex = -1;
    blockThreshold = 4500;
    /** The run ID AKA the Message ID associated with the complete generation */
    runId;
    handlers;
    constructor({ runId, handlers, accumulate, reasoningKey, blockThreshold, }) {
        this.runId = runId;
        this.handlers = handlers;
        if (reasoningKey) {
            this.reasoningKey = reasoningKey;
        }
        if (blockThreshold != null) {
            this.blockThreshold = blockThreshold;
        }
        this.accumulate = accumulate ?? false;
    }
    getMessageId = () => {
        const messageId = this.currentMessageId;
        if (messageId != null && messageId) {
            return messageId;
        }
        return undefined;
    };
    createMessageStep = (type) => {
        if (type != null && this.currentType !== type) {
            this.currentType = type;
        }
        this.currentLength = 0;
        this.currentIndex += 1;
        this.currentStepId = `step_${nanoid()}`;
        this.currentMessageId = `msg_${nanoid()}`;
        return [this.currentStepId, this.currentMessageId];
    };
    dispatchRunStep = (stepId, stepDetails) => {
        const runStep = {
            id: stepId,
            runId: this.runId,
            type: stepDetails.type,
            index: this.currentIndex,
            stepDetails,
            // usage: null,
        };
        this.handlers?.[GraphEvents.ON_RUN_STEP]?.({
            event: GraphEvents.ON_RUN_STEP,
            data: runStep,
        });
    };
    dispatchMessageDelta = (stepId, delta) => {
        const messageDelta = {
            id: stepId,
            delta,
        };
        this.handlers?.[GraphEvents.ON_MESSAGE_DELTA]?.({
            event: GraphEvents.ON_MESSAGE_DELTA,
            data: messageDelta,
        });
    };
    dispatchReasoningDelta = (stepId, delta) => {
        const reasoningDelta = {
            id: stepId,
            delta,
        };
        this.handlers?.[GraphEvents.ON_REASONING_DELTA]?.({
            event: GraphEvents.ON_REASONING_DELTA,
            data: reasoningDelta,
        });
    };
    handleContent = (content, _type) => {
        let type = _type;
        if (this.inThinkBlock && type === ContentTypes.TEXT) {
            type = ContentTypes.THINK;
        }
        if (this.accumulate) {
            if (type === ContentTypes.THINK) {
                this.reasoningTokens.push(content);
            }
            else {
                this.tokens.push(content);
            }
        }
        if (this.currentType !== type) {
            const [newStepId, newMessageId] = this.createMessageStep(type);
            this.dispatchRunStep(newStepId, {
                type: StepTypes.MESSAGE_CREATION,
                message_creation: {
                    message_id: newMessageId,
                },
            });
        }
        const stepId = this.currentStepId ?? '';
        if (type === ContentTypes.THINK) {
            this.dispatchReasoningDelta(stepId, {
                content: [
                    {
                        type: ContentTypes.THINK,
                        think: content,
                    },
                ],
            });
        }
        else {
            this.dispatchMessageDelta(stepId, {
                content: [
                    {
                        type: ContentTypes.TEXT,
                        text: content,
                    },
                ],
            });
        }
        this.currentLength += content.length;
        if (this.inCodeBlock) {
            return;
        }
        if (this.currentLength > this.blockThreshold &&
            SEPARATORS.some((sep) => content.includes(sep))) {
            const [newStepId, newMessageId] = this.createMessageStep(type);
            this.dispatchRunStep(newStepId, {
                type: StepTypes.MESSAGE_CREATION,
                message_creation: {
                    message_id: newMessageId,
                },
            });
        }
    };
    getDeltaContent(chunk) {
        return chunk?.choices?.[0]?.delta?.content ?? '';
    }
    getReasoningDelta(chunk) {
        return (chunk?.choices?.[0]?.delta?.[this.reasoningKey] ??
            '');
    }
    handle(chunk) {
        if (!chunk) {
            return;
        }
        const content = this.getDeltaContent(chunk);
        const reasoning_content = this.getReasoningDelta(chunk);
        if (!content.length && !reasoning_content.length) {
            return;
        }
        if (content.includes('```')) {
            this.inCodeBlock = !this.inCodeBlock;
        }
        if (content.includes('<think>') && !this.inCodeBlock) {
            this.inThinkBlock = true;
        }
        else if (this.lastToken.includes('</think>') && !this.inCodeBlock) {
            this.inThinkBlock = false;
        }
        this.lastToken = content;
        const message_id = this.getMessageId() ?? '';
        if (!message_id) {
            const initialContentType = this.inThinkBlock
                ? ContentTypes.THINK
                : ContentTypes.TEXT;
            const initialType = reasoning_content
                ? ContentTypes.THINK
                : initialContentType;
            const [stepId, message_id] = this.createMessageStep(initialType);
            this.dispatchRunStep(stepId, {
                type: StepTypes.MESSAGE_CREATION,
                message_creation: {
                    message_id,
                },
            });
        }
        if (reasoning_content) {
            this.handleContent(reasoning_content, ContentTypes.THINK);
        }
        else {
            this.handleContent(content, ContentTypes.TEXT);
        }
    }
}

export { SEPARATORS, SplitStreamHandler };
//# sourceMappingURL=splitStream.mjs.map
