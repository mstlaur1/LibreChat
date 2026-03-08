// Context usage indicator + manual compaction button for LibreChat
// Polls /proxy/context and renders token count above the chat input
(function() {
  'use strict';

  var MAX_TOKENS = 75000;
  var POLL_INTERVAL = 3000;
  var indicator = null;
  var tooltip = null;
  var compactBtn = null;
  var lastData = null;
  var lastCompactionTs = -1; // -1 = not yet initialized (first poll sets baseline)

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function getColor(ratio) {
    if (ratio >= 0.90) return '#ef4444';
    if (ratio >= 0.75) return '#eab308';
    return '#9ca3af';
  }

  function createIndicator() {
    indicator = document.createElement('div');
    indicator.id = 'context-indicator';

    tooltip = document.createElement('div');
    tooltip.id = 'context-tooltip';
    tooltip.style.cssText = 'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;padding:8px 12px;font-size:11px;white-space:pre;z-index:9999;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-bottom:4px;';

    compactBtn = document.createElement('button');
    compactBtn.id = 'compact-btn';
    compactBtn.textContent = 'Compact';
    compactBtn.style.cssText = 'display:none;margin-left:8px;font-size:11px;padding:1px 8px;border:1px solid #45475a;border-radius:4px;background:#313244;color:#cdd6f4;cursor:pointer;font-family:monospace;vertical-align:middle;';
    compactBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Extract conversationId from URL: /c/{conversationId}
      var match = window.location.pathname.match(/^\/c\/([^/]+)/);
      if (!match) {
        compactBtn.textContent = 'No convo';
        setTimeout(function() { compactBtn.textContent = 'Compact'; }, 2000);
        return;
      }
      var conversationId = match[1];
      compactBtn.textContent = 'Compacting...';
      compactBtn.disabled = true;
      fetch('/api/conversations/' + conversationId + '/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            compactBtn.textContent = 'Done';
            showCompactionNotice();
            // Reload to show compacted messages
            setTimeout(function() { window.location.reload(); }, 2000);
          } else {
            compactBtn.textContent = data.error || 'Error';
            compactBtn.disabled = false;
          }
        })
        .catch(function() {
          compactBtn.textContent = 'Error';
          compactBtn.disabled = false;
        });
    });
    compactBtn.addEventListener('mouseenter', function() {
      compactBtn.style.background = '#45475a';
    });
    compactBtn.addEventListener('mouseleave', function() {
      compactBtn.style.background = '#313244';
    });

    indicator.appendChild(tooltip);
    indicator.appendChild(compactBtn);

    indicator.addEventListener('mouseenter', function() {
      tooltip.style.display = 'block';
      if (lastData && lastData.prompt_tokens > 0) compactBtn.style.display = 'inline-block';
    });
    indicator.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
      compactBtn.style.display = 'none';
    });

    return indicator;
  }

  function updateDisplay(data) {
    if (!indicator) return;
    var pt = data.prompt_tokens || 0;
    var max = data.max_tokens || MAX_TOKENS;
    var ratio = pt / max;
    var color = getColor(ratio);

    indicator.style.color = color;

    var text = indicator.querySelector('.ci-text');
    if (!text) {
      text = document.createElement('span');
      text.className = 'ci-text';
      indicator.insertBefore(text, tooltip);
    }
    text.textContent = 'Context used: ' + formatTokens(pt) + ' / ' + formatTokens(max);

    var bd = data.breakdown || {};
    var lines = [];
    if (bd.system) lines.push('System:      ' + formatTokens(bd.system).padStart(7));
    if (bd.messages) lines.push('Messages:    ' + formatTokens(bd.messages).padStart(7));
    if (bd.tools) lines.push('Tools:       ' + formatTokens(bd.tools).padStart(7));
    lines.push('\u2500'.repeat(20));
    lines.push('Total:       ' + formatTokens(pt).padStart(7) + ' / ' + formatTokens(max));
    lines.push('Used:        ' + (ratio * 100).toFixed(1) + '%');
    tooltip.textContent = lines.join('\n');
  }

  function mountIndicator() {
    if (document.getElementById('context-indicator')) return true;

    var textarea = document.getElementById('prompt-textarea') ||
                   document.querySelector('[data-testid="text-input"]');
    if (!textarea) return false;

    var container = textarea.closest('form') || textarea.parentElement;
    while (container && container !== document.body) {
      if (container.offsetWidth > 400) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) return false;

    var el = createIndicator();
    el.style.cssText = 'position:relative;display:block;text-align:center;font-size:12px;color:#9ca3af;padding:2px 0;cursor:default;font-family:monospace;user-select:none;margin-bottom:2px;';
    container.parentElement.insertBefore(el, container);
    return true;
  }

  function showCompactionNotice() {
    // Fixed-position toast — guaranteed visible regardless of DOM structure
    var existing = document.getElementById('compaction-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'compaction-toast';
    toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:10px;padding:16px 28px;font-size:14px;font-style:italic;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.5);text-align:center;opacity:0;transition:opacity 0.3s ease;';
    toast.textContent = 'Compacting conversation so we can keep chatting.';
    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { toast.style.opacity = '1'; });
    });

    // Fade out after 4 seconds
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 400);
    }, 4000);
  }

  function poll() {
    fetch('/proxy/context')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.prompt_tokens !== undefined) {
          lastData = data;
          if (!indicator && !mountIndicator()) return;
          updateDisplay(data);

          // Detect new compaction event
          var compTs = data.last_compaction || 0;
          if (lastCompactionTs === -1) {
            // First poll — set baseline, don't show stale notice
            lastCompactionTs = compTs;
          } else if (compTs > 0 && compTs > lastCompactionTs) {
            lastCompactionTs = compTs;
            showCompactionNotice();
          }
        }
      })
      .catch(function() {});
  }

  function init() {
    mountIndicator();
    if (lastData) updateDisplay(lastData);

    setInterval(poll, POLL_INTERVAL);
    poll();

    // Debounced MutationObserver — don't fire on every DOM mutation
    var remountTimer = null;
    var observer = new MutationObserver(function() {
      if (remountTimer) return;
      remountTimer = setTimeout(function() {
        remountTimer = null;
        if (!document.getElementById('context-indicator')) {
          indicator = null;
          tooltip = null;
          compactBtn = null;
          mountIndicator();
          if (lastData) updateDisplay(lastData);
        }
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
