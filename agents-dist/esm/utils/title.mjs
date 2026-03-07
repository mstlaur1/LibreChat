import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { ContentTypes } from '../common/enum.mjs';

const defaultTitlePrompt = `Analyze this conversation and provide:
1. The detected language of the conversation
2. A concise title in the detected language (5 words or less, no punctuation or quotation)

{convo}`;
const titleSchema = {
    type: 'object',
    properties: {
        title: {
            type: 'string',
            description: 'A concise title for the conversation in 5 words or less, without punctuation or quotation',
        },
    },
    required: ['title'],
};
const combinedSchema = {
    type: 'object',
    properties: {
        language: {
            type: 'string',
            description: 'The detected language of the conversation',
        },
        title: {
            type: 'string',
            description: 'A concise title for the conversation in 5 words or less, without punctuation or quotation',
        },
    },
    required: ['language', 'title'],
};
const createTitleRunnable = async (model, _titlePrompt) => {
    // Disabled since this works fine
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    const titleLLM = model.withStructuredOutput(titleSchema);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    const combinedLLM = model.withStructuredOutput(combinedSchema);
    const titlePrompt = ChatPromptTemplate.fromTemplate(_titlePrompt ?? defaultTitlePrompt).withConfig({ runName: 'TitlePrompt' });
    const titleOnlyInnerChain = RunnableSequence.from([titlePrompt, titleLLM]);
    const combinedInnerChain = RunnableSequence.from([titlePrompt, combinedLLM]);
    /** Wrap titleOnlyChain in RunnableLambda to create parent span */
    const titleOnlyChain = new RunnableLambda({
        func: async (input, config) => {
            const result = await titleOnlyInnerChain.invoke(input, config);
            return result;
        },
    }).withConfig({ runName: 'TitleOnlyChain' });
    /** Wrap combinedChain in RunnableLambda to create parent span */
    const combinedChain = new RunnableLambda({
        func: async (input, config) => {
            const result = await combinedInnerChain.invoke(input, config);
            return result;
        },
    }).withConfig({ runName: 'TitleLanguageChain' });
    /** Runnable to add default values if needed */
    const addDefaults = new RunnableLambda({
        func: (result) => ({
            language: result?.language ?? 'English',
            title: result?.title ?? '',
        }),
    }).withConfig({ runName: 'AddDefaults' });
    const combinedChainInner = RunnableSequence.from([
        combinedChain,
        addDefaults,
    ]);
    /** Wrap combinedChainWithDefaults in RunnableLambda to create parent span */
    const combinedChainWithDefaults = new RunnableLambda({
        func: async (input, config) => {
            return await combinedChainInner.invoke(input, config);
        },
    }).withConfig({ runName: 'CombinedChainWithDefaults' });
    return new RunnableLambda({
        func: async (input, config) => {
            const invokeInput = { convo: input.convo };
            if (input.skipLanguage) {
                return (await titleOnlyChain.invoke(invokeInput, config));
            }
            return await combinedChainWithDefaults.invoke(invokeInput, config);
        },
    }).withConfig({ runName: 'TitleGenerator' });
};
const defaultCompletionPrompt = `Provide a concise, 5-word-or-less title for the conversation, using title case conventions. Only return the title itself.

Conversation:
{convo}`;
const createCompletionTitleRunnable = async (model, titlePrompt) => {
    const completionPrompt = ChatPromptTemplate.fromTemplate(titlePrompt ?? defaultCompletionPrompt).withConfig({ runName: 'CompletionTitlePrompt' });
    /** Runnable to extract content from model response */
    const extractContent = new RunnableLambda({
        func: (response) => {
            let content = '';
            if (typeof response.content === 'string') {
                content = response.content;
            }
            else if (Array.isArray(response.content)) {
                content = response.content
                    .filter((part) => part.type === ContentTypes.TEXT)
                    .map((part) => part.text)
                    .join('');
            }
            return { title: content.trim() };
        },
    }).withConfig({ runName: 'ExtractTitle' });
    const innerChain = RunnableSequence.from([
        completionPrompt,
        model,
        extractContent,
    ]);
    /** Wrap in RunnableLambda to create a parent span for LangFuse */
    return new RunnableLambda({
        func: async (input, config) => {
            return await innerChain.invoke(input, config);
        },
    }).withConfig({ runName: 'CompletionTitleChain' });
};

export { createCompletionTitleRunnable, createTitleRunnable };
//# sourceMappingURL=title.mjs.map
