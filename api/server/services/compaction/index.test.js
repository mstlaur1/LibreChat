'use strict';

const { compactMessages, CUE_PHRASES } = require('./index');

function makeMessages(pairs) {
  return pairs.map(([role, content]) => ({ role, content }));
}

describe('compactMessages', () => {
  test('returns null for fewer than 4 messages', () => {
    const msgs = makeMessages([
      ['system', 'You are helpful.'],
      ['user', 'Hello'],
      ['assistant', 'Hi there!'],
    ]);
    expect(compactMessages(msgs)).toBeNull();
  });

  test('returns null if no system message', () => {
    const msgs = makeMessages([
      ['user', 'Hello'],
      ['assistant', 'Hi there!'],
      ['user', 'How are you?'],
      ['assistant', 'I am fine.'],
      ['user', 'Great'],
    ]);
    expect(compactMessages(msgs)).toBeNull();
  });

  test('compacts a multi-turn conversation and returns valid result', () => {
    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', 'Tell me about the architecture of the system and how the components interact with each other.'],
      ['assistant', 'The architecture consists of a frontend application and a backend API server that communicate over REST. The database stores persistent state.'],
      ['user', 'What about the caching layer and how it improves performance across the system?'],
      ['assistant', 'The caching layer sits between the API and the database. It uses Redis with a TTL-based eviction strategy for optimal memory usage.'],
      ['user', 'Can you explain the deployment process and how we push code to production?'],
      ['assistant', 'Deployment uses Docker containers orchestrated with Compose. The CI pipeline builds images and runs tests before deploying.'],
      ['user', 'How do we handle database migrations in this system?'],
      ['assistant', 'Database migrations are managed with a migration tool that tracks applied changes. Each migration has an up and down function.'],
      ['user', 'What monitoring tools do we use to track system health and performance metrics?'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('systemMessage', 'You are a helpful assistant.');
    expect(result).toHaveProperty('summaryContent');
    expect(result).toHaveProperty('lastUserMessage');
    expect(result).toHaveProperty('selectedCount');
    expect(typeof result.selectedCount).toBe('number');
    expect(result.selectedCount).toBeGreaterThan(0);
  });

  test('summaryContent contains continuation framing text', () => {
    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', 'Tell me about the architecture of the system and how the components interact with each other.'],
      ['assistant', 'The architecture consists of a frontend application and a backend API server that communicate over REST. The database stores persistent state.'],
      ['user', 'What about the caching layer and how it improves performance across the system?'],
      ['assistant', 'The caching layer sits between the API and the database. It uses Redis with a TTL-based eviction strategy for optimal memory usage.'],
      ['user', 'Can you explain the deployment process and how we push code to production?'],
      ['assistant', 'Deployment uses Docker containers orchestrated with Compose. The CI pipeline builds images and runs tests before deploying.'],
      ['user', 'How do we handle database migrations in this system?'],
      ['assistant', 'Database migrations are managed with a migration tool that tracks applied changes. Each migration has an up and down function.'],
      ['user', 'What monitoring tools do we use?'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.summaryContent).toContain(
      'This session is being continued from a previous conversation that ran out of context.',
    );
    expect(result.summaryContent).toContain(
      'Continue the conversation from where it left off without asking the user any further questions.',
    );
  });

  test('lastUserMessage is the final user message content', () => {
    const finalQuestion = 'What monitoring tools do we use to track system health and performance metrics?';
    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', 'Tell me about the architecture of the system and how the components interact with each other.'],
      ['assistant', 'The architecture consists of a frontend application and a backend API server that communicate over REST. The database stores persistent state.'],
      ['user', 'What about the caching layer and how it improves performance across the system?'],
      ['assistant', 'The caching layer sits between the API and the database. It uses Redis with a TTL-based eviction strategy for optimal memory usage.'],
      ['user', 'Can you explain the deployment process and how we push code to production?'],
      ['assistant', 'Deployment uses Docker containers orchestrated with Compose. The CI pipeline builds images and runs tests before deploying.'],
      ['user', 'How do we handle database migrations in this system?'],
      ['assistant', 'Database migrations are managed with a migration tool that tracks applied changes. Each migration has an up and down function.'],
      ['user', finalQuestion],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.lastUserMessage).toBe(finalQuestion);
  });

  test('tool messages are skipped during summarization', () => {
    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', 'Search for information about the deployment architecture and infrastructure setup.'],
      ['assistant', 'Let me search for that information about the deployment architecture and how it is configured.'],
      ['tool', '{"results": [{"title": "Deployment Guide", "content": "Docker containers are used for deployment."}]}'],
      ['assistant', 'Based on the search results, the deployment uses Docker containers with orchestration through Compose files and CI pipelines.'],
      ['user', 'What about the monitoring and alerting setup for production systems?'],
      ['assistant', 'The monitoring stack includes Prometheus for metrics collection, Grafana for visualization, and AlertManager for alerting on thresholds.'],
      ['user', 'How do we handle incident response procedures when alerts fire?'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    // The tool message raw JSON should not appear in the summary
    expect(result.summaryContent).not.toContain('"results"');
    expect(result.summaryContent).not.toContain('Deployment Guide');
  });

  test('last user+assistant exchange preserved verbatim in summary', () => {
    const lastUserContent = 'How do we handle database migrations in this system and track schema changes?';
    const lastAssistantContent =
      'Database migrations are managed with a migration tool that tracks applied changes. Each migration has an up and down function for rollbacks.';

    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', 'Tell me about the architecture of the system and how the components interact with each other.'],
      ['assistant', 'The architecture consists of a frontend application and a backend API server that communicate over REST. The database stores persistent state.'],
      ['user', 'What about the caching layer and how it improves performance across the system?'],
      ['assistant', 'The caching layer sits between the API and the database. It uses Redis with a TTL-based eviction strategy for optimal memory usage.'],
      ['user', 'Can you explain the deployment process and how we push code to production?'],
      ['assistant', 'Deployment uses Docker containers orchestrated with Compose. The CI pipeline builds images and runs tests before deploying to production.'],
      ['user', lastUserContent],
      ['assistant', lastAssistantContent],
      ['user', 'What monitoring tools do we use to track system health and performance metrics?'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.summaryContent).toContain('The last two exchanges verbatim were:');
    expect(result.summaryContent).toContain(`User: ${lastUserContent}`);
    expect(result.summaryContent).toContain(`Assistant: ${lastAssistantContent}`);
  });

  test('multi-compaction: processes conversations that were already compacted', () => {
    const priorSummary =
      'This session is being continued from a previous conversation that ran out of context. ' +
      'The summary below covers the earlier portion of the conversation.\n\n' +
      '- User: We discussed setting up the Docker deployment pipeline on server 192.168.10.100 with Redis caching.\n' +
      '- Assistant: The deployment uses docker-compose.yml with health checks and memory limits configured properly.\n' +
      '- User: We also configured the monitoring stack with Prometheus and Grafana dashboards.\n' +
      '- Assistant: The monitoring endpoints are exposed on port 9090 for Prometheus and port 3000 for Grafana.';

    const msgs = makeMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', priorSummary],
      ['assistant', 'I understand the context from the previous conversation about Docker deployment and monitoring configuration.'],
      ['user', 'Now let us configure the alerting rules for the Prometheus instance on server 192.168.10.100 monitoring stack.'],
      ['assistant', 'For alerting rules in Prometheus, we need to create rule files that define alert conditions and notification channels.'],
      ['user', 'What thresholds should we set for CPU and memory alerts on the Docker containers running on 192.168.10.100?'],
      ['assistant', 'For Docker containers, typical thresholds are 80% CPU for warning and 95% for critical. Memory alerts at 85% warning and 95% critical.'],
      ['user', 'How do we integrate AlertManager with the existing Grafana setup for unified notifications?'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.summaryContent).toContain(
      'This session is being continued from a previous conversation',
    );
    expect(result.selectedCount).toBeGreaterThan(0);
  });

  test('CUE_PHRASES is exported as a Set', () => {
    expect(CUE_PHRASES).toBeInstanceOf(Set);
    expect(CUE_PHRASES.size).toBeGreaterThan(0);
    expect(CUE_PHRASES.has('the plan is')).toBe(true);
  });
});
