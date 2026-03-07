import { Runnable, patchConfig, mergeConfigs } from '@langchain/core/runnables';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';

/**
 * Delays the execution for a specified number of milliseconds.
 *
 * @param {number} ms - The number of milliseconds to delay.
 * @return {Promise<void>} A promise that resolves after the specified delay.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class RunnableCallable extends Runnable {
    lc_namespace = ['langgraph'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func;
    tags;
    config;
    trace = true;
    recurse = true;
    constructor(fields) {
        super();
        this.name = fields.name ?? fields.func.name;
        this.func = fields.func;
        this.config = fields.tags ? { tags: fields.tags } : undefined;
        this.trace = fields.trace ?? this.trace;
        this.recurse = fields.recurse ?? this.recurse;
    }
    async _tracedInvoke(input, config, runManager) {
        return new Promise((resolve, reject) => {
            let childConfig = patchConfig(config, {
                callbacks: runManager?.getChild(),
            });
            void AsyncLocalStorageProviderSingleton.runWithConfig(childConfig, async () => {
                try {
                    const output = await this.func(input, childConfig);
                    childConfig = null;
                    resolve(output);
                }
                catch (e) {
                    childConfig = null;
                    reject(e);
                }
            });
        });
    }
    async invoke(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input, options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let returnValue;
        if (this.trace) {
            returnValue = await this._callWithConfig(this._tracedInvoke, input, mergeConfigs(this.config, options));
        }
        else {
            returnValue = await this.func(input, mergeConfigs(this.config, options));
        }
        if (Runnable.isRunnable(returnValue) && this.recurse) {
            return await returnValue.invoke(input, options);
        }
        return returnValue;
    }
}

export { RunnableCallable, sleep };
//# sourceMappingURL=run.mjs.map
