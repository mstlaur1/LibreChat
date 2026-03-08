import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

const MAX_TOKENS = 75000;
const POLL_INTERVAL = 3000;

interface ContextData {
  prompt_tokens: number;
  max_tokens?: number;
  breakdown?: { system?: number; messages?: number; tools?: number };
  last_compaction?: number;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return String(n);
}

function getColor(ratio: number): string {
  if (ratio >= 0.9) return 'text-red-500';
  if (ratio >= 0.75) return 'text-yellow-500';
  return 'text-gray-400';
}

export default function ContextIndicator() {
  const { conversationId } = useParams();
  const { token } = useAuthContext();
  const [data, setData] = useState<ContextData | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [compactState, setCompactState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [toast, setToast] = useState(false);
  const lastCompactionTs = useRef(-1);

  // Poll /proxy/context
  useEffect(() => {
    if (!conversationId || conversationId === Constants.NEW_CONVO) {
      setData(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/proxy/context');
        if (cancelled) return;
        const json = await res.json();
        if (json?.prompt_tokens !== undefined) {
          setData(json);
          // Detect new compaction event from proxy
          const compTs = json.last_compaction || 0;
          if (lastCompactionTs.current === -1) {
            lastCompactionTs.current = compTs;
          } else if (compTs > 0 && compTs > lastCompactionTs.current) {
            lastCompactionTs.current = compTs;
            showToastNotice();
          }
        }
      } catch {
        // Proxy unreachable — silent
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  const showToastNotice = useCallback(() => {
    setToast(true);
    setTimeout(() => setToast(false), 4000);
  }, []);

  const handleCompact = useCallback(async () => {
    if (!conversationId || !token) return;
    setCompactState('working');
    try {
      const res = await fetch(`/api/conversations/${conversationId}/compact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await res.json();
      if (result.success) {
        setCompactState('done');
        showToastNotice();
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setCompactState('error');
        setTimeout(() => setCompactState('idle'), 3000);
      }
    } catch {
      setCompactState('error');
      setTimeout(() => setCompactState('idle'), 3000);
    }
  }, [conversationId, token, showToastNotice]);

  if (!data || !data.prompt_tokens) return null;

  const pt = data.prompt_tokens;
  const max = data.max_tokens || MAX_TOKENS;
  const ratio = pt / max;
  const bd = data.breakdown || {};

  const tooltipLines = [
    bd.system ? `System:      ${formatTokens(bd.system).padStart(7)}` : '',
    bd.messages ? `Messages:    ${formatTokens(bd.messages).padStart(7)}` : '',
    bd.tools ? `Tools:       ${formatTokens(bd.tools).padStart(7)}` : '',
    '─'.repeat(20),
    `Total:       ${formatTokens(pt).padStart(7)} / ${formatTokens(max)}`,
    `Used:        ${(ratio * 100).toFixed(1)}%`,
  ].filter(Boolean);

  const compactLabel =
    compactState === 'working'
      ? 'Compacting...'
      : compactState === 'done'
        ? 'Done'
        : compactState === 'error'
          ? 'Error'
          : 'Compact';

  return (
    <>
      <div
        className="relative select-none text-center font-mono text-xs"
        style={{ padding: '2px 0', marginBottom: '2px' }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className={getColor(ratio)}>
          Context used: {formatTokens(pt)} / {formatTokens(max)}
        </span>

        {showTooltip && pt > 0 && (
          <button
            type="button"
            className="ml-2 cursor-pointer rounded border border-border-medium bg-surface-secondary px-2 py-px font-mono text-xs text-text-secondary hover:bg-surface-tertiary"
            disabled={compactState !== 'idle'}
            onClick={handleCompact}
          >
            {compactLabel}
          </button>
        )}

        {showTooltip && (
          <div
            className="absolute bottom-full left-1/2 z-50 mb-1 min-w-[200px] -translate-x-1/2 whitespace-pre rounded-md border border-border-medium bg-surface-primary p-2 font-mono text-xs text-text-secondary shadow-lg"
          >
            {tooltipLines.join('\n')}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-medium bg-surface-primary px-7 py-4 text-sm italic text-text-primary shadow-xl transition-opacity duration-300">
          Compacting conversation so we can keep chatting.
        </div>
      )}
    </>
  );
}
