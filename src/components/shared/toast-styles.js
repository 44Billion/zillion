const OPEN_ANIM_MS = 200
const SWAP_FADE_MS = 120

export default /* css */`
  z-toast .toast-card {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top));
    left: 0;
    right: 0;
    margin-inline: auto;
    width: calc(100% - 24px - env(safe-area-inset-left) - env(safe-area-inset-right));
    max-width: calc(var(--z-mobile-width) - 24px);
    max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    overflow: auto;
    z-index: 9999;
    box-sizing: border-box;
    background-color: var(--z-surface);
    color: var(--z-text);
    border: 1px solid var(--z-border);
    border-radius: 4px;
    padding: 10px 12px;
    box-shadow: 0 6px 18px var(--z-shadow);
    opacity: 0.7;
    transform: translateY(6px);
    transition: opacity ${OPEN_ANIM_MS}ms ease-out, transform ${OPEN_ANIM_MS}ms ease-out;
  }
  z-toast .toast-card.is-open {
    opacity: 1;
    transform: translateY(0);
  }
  z-toast .toast-card.is-closing {
    opacity: 0;
    transform: translateY(6px);
  }
  z-toast .toast-card[data-type="success"] { border-left: 4px solid var(--z-success); }
  z-toast .toast-card[data-type="error"]   { border-left: 4px solid var(--z-error); }
  z-toast .toast-card[data-type="warning"] { border-left: 4px solid var(--z-warning); }
  z-toast .toast-card[data-type="info"]    { border-left: 4px solid var(--z-info); }

  z-toast .toast-card .toast-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  z-toast .toast-card .toast-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }
  z-toast .toast-card .toast-icon svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  z-toast .toast-card[data-type="success"] .toast-icon { color: var(--z-success); }
  z-toast .toast-card[data-type="error"]   .toast-icon { color: var(--z-error); }
  z-toast .toast-card[data-type="warning"] .toast-icon { color: var(--z-warning); }
  z-toast .toast-card[data-type="info"]    .toast-icon { color: var(--z-info); }

  z-toast .toast-card .toast-body {
    flex: 1 1 auto;
    min-width: 0;
    align-self: center;
  }
  z-toast .toast-card .toast-message {
    font-size: 16rem;
    line-height: 1.35;
    word-break: break-word;
  }

  /* Reset so a button works as a clickable inline row. */
  z-toast .toast-card .toast-long {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
    margin-top: 6px;
    display: none;
    align-items: center;
    gap: 6px;
    font-size: 14rem;
    color: var(--z-muted);
    font-family: inherit;
  }
  z-toast .toast-card[data-has-long] .toast-long {
    display: flex;
  }
  z-toast .toast-card .toast-long:active {
    color: var(--z-text);
  }
  z-toast .toast-card .toast-long-preview {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  z-toast .toast-card .toast-long-toggle {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: inherit;
    transition: transform 180ms ease-out;
  }
  z-toast .toast-card .toast-long-toggle svg {
    width: 16px;
    height: 16px;
    display: block;
  }
  z-toast .toast-card[data-expanded] .toast-long-toggle {
    transform: rotate(180deg);
  }
  z-toast .toast-card .toast-long-text {
    margin-top: 6px;
    padding: 8px 10px;
    background-color: var(--z-control);
    border-radius: 6px;
    font-size: 14rem;
    line-height: 1.4;
    color: var(--z-text);
    word-break: break-word;
    white-space: pre-wrap;
    max-height: 240px;
    overflow: auto;
    display: none;
  }
  z-toast .toast-card[data-has-long][data-expanded] .toast-long-text {
    display: block;
  }

  z-toast .toast-card .toast-btn {
    flex-shrink: 0;
    background: transparent;
    border: 0;
    padding: 0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--z-muted);
    cursor: pointer;
  }
  z-toast .toast-card .toast-btn:active {
    background-color: var(--z-pressed);
    color: var(--z-text);
  }
  z-toast .toast-card .toast-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  z-toast .toast-card .toast-btn svg {
    width: 16px;
    height: 16px;
    display: block;
  }

  z-toast .toast-card .toast-nav {
    margin-top: 8px;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--z-muted);
    font-size: 12rem;
  }
  z-toast .toast-card[data-multi] .toast-nav {
    display: flex;
  }
  z-toast .toast-card .toast-nav-prev svg { transform: rotate(90deg); }
  z-toast .toast-card .toast-nav-next svg { transform: rotate(-90deg); }
  z-toast .toast-card .toast-counter {
    min-width: 36px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* Content swap fade — close button is excluded so it's always tappable. */
  z-toast .toast-card .toast-fader {
    transition: opacity ${SWAP_FADE_MS}ms ease-out;
  }
  z-toast .toast-card.is-swapping .toast-fader {
    opacity: 0.35;
  }

  @media (prefers-reduced-motion: reduce) {
    z-toast .toast-card, z-toast .toast-card .toast-fader,
    z-toast .toast-card .toast-long-toggle { transition: none; }
  }
`
