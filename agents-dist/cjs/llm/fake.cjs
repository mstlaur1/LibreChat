'use strict';

var outputs = require('@langchain/core/outputs');
var messages = require('@langchain/core/messages');
var testing = require('@langchain/core/utils/testing');

class FakeChatModel extends testing.FakeListChatModel {
    splitStrategy;
    toolCalls = [];
    addedToolCalls = false;
    constructor({ responses, sleep, emitCustomEvent, splitStrategy = { type: 'regex', value: /(?<=\s+)|(?=\s+)/ }, toolCalls = [] }) {
        super({ responses, sleep, emitCustomEvent });
        this.splitStrategy = splitStrategy;
        this.toolCalls = toolCalls;
    }
    splitText(text) {
        if (this.splitStrategy.type === 'regex') {
            return text.split(this.splitStrategy.value);
        }
        else {
            const chunkSize = this.splitStrategy.value;
            const chunks = [];
            for (let i = 0; i < text.length; i += chunkSize) {
                chunks.push(text.slice(i, i + chunkSize));
            }
            return chunks;
        }
    }
    _createResponseChunk(text, tool_call_chunks) {
        return new outputs.ChatGenerationChunk({
            text,
            generationInfo: {},
            message: new messages.AIMessageChunk({
                content: text,
                tool_call_chunks,
                additional_kwargs: tool_call_chunks ? {
                    tool_calls: tool_call_chunks.map((toolCall) => ({
                        index: toolCall.index ?? 0,
                        id: toolCall.id ?? '',
                        type: 'function',
                        function: {
                            name: toolCall.name ?? '',
                            arguments: toolCall.args ?? '',
                        },
                    })),
                } : undefined,
            })
        });
    }
    async *_streamResponseChunks(_messages, options, runManager) {
        const response = this._currentResponse();
        this._incrementResponse();
        if (this.emitCustomEvent) {
            await runManager?.handleCustomEvent('some_test_event', {
                someval: true,
            });
        }
        const chunks = this.splitText(response);
        for await (const chunk of chunks) {
            await this._sleepIfRequested();
            if (options.thrownErrorString != null && options.thrownErrorString) {
                throw new Error(options.thrownErrorString);
            }
            const responseChunk = super._createResponseChunk(chunk);
            yield responseChunk;
            void runManager?.handleLLMNewToken(chunk);
        }
        await this._sleepIfRequested();
        if (this.toolCalls.length > 0 && !this.addedToolCalls) {
            this.addedToolCalls = true;
            const toolCallChunks = this.toolCalls.map((toolCall) => {
                return {
                    name: toolCall.name,
                    args: JSON.stringify(toolCall.args),
                    id: toolCall.id,
                    type: 'tool_call_chunk',
                };
            });
            const responseChunk = this._createResponseChunk('', toolCallChunks);
            yield responseChunk;
            void runManager?.handleLLMNewToken('');
        }
    }
}
function createFakeStreamingLLM({ responses, sleep, splitStrategy, toolCalls, }) {
    return new FakeChatModel({
        sleep,
        responses,
        emitCustomEvent: true,
        splitStrategy,
        toolCalls,
    });
}

exports.FakeChatModel = FakeChatModel;
exports.createFakeStreamingLLM = createFakeStreamingLLM;
//# sourceMappingURL=fake.cjs.map
