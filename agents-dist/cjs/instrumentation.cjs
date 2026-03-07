'use strict';

var sdkNode = require('@opentelemetry/sdk-node');
var otel = require('@langfuse/otel');
var misc = require('./utils/misc.cjs');

if (misc.isPresent(process.env.LANGFUSE_SECRET_KEY) &&
    misc.isPresent(process.env.LANGFUSE_PUBLIC_KEY) &&
    misc.isPresent(process.env.LANGFUSE_BASE_URL)) {
    const langfuseSpanProcessor = new otel.LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    });
    const sdk = new sdkNode.NodeSDK({
        spanProcessors: [langfuseSpanProcessor],
    });
    sdk.start();
}
//# sourceMappingURL=instrumentation.cjs.map
