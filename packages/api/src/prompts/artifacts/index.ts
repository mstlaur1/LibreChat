import dedent from 'dedent';
import { EModelEndpoint, ArtifactModes } from 'librechat-data-provider';
import { generateShadcnPrompt } from './generate';
import { components } from './components';

const artifactsHint = dedent`The assistant can create artifacts — self-contained, interactive content rendered in a side panel. Use for substantial content (>15 lines) the user will modify, reuse, or interact with. Do not use for short answers or explanations.

Basic syntax:
:::artifact{identifier="my-id" type="TYPE" title="My Title"}
\`\`\`
content here
\`\`\`
:::

Types: "text/html", "image/svg+xml", "text/markdown", "application/vnd.mermaid", "application/vnd.react"

For React artifacts: use default export, Tailwind styling, available libs: react, lucide-react, recharts, three, date-fns. shadcn/ui from \`/components/ui/name\`. No other libs.`;

/**
 * Generates an artifacts prompt based on the endpoint and artifact mode.
 * Returns a slim hint instead of the full prompt — full docs are gated
 * behind tool --help to save prefill tokens.
 */
export function generateArtifactsPrompt(params: {
  endpoint: EModelEndpoint | string;
  artifacts: ArtifactModes;
}): string | null {
  const { endpoint, artifacts } = params;

  if (artifacts === ArtifactModes.CUSTOM) {
    return null;
  }

  let prompt = artifactsHint;

  if (artifacts === ArtifactModes.SHADCNUI) {
    prompt += generateShadcnPrompt({ components, useXML: endpoint === EModelEndpoint.anthropic });
  }

  return prompt;
}
