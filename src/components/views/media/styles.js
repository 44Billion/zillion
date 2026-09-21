// Media keeps a dark, neutral surround in either app theme.
export const viewerStyles = `
  z-media-viewer-route .media-viewer {
    color-scheme: dark;
    position: absolute; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden; background: var(--z-viewer-canvas); color: var(--z-viewer-text);
    button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 10px;
      border: 0; border-radius: 50%; background: var(--z-viewer-control); color: var(--z-viewer-text); cursor: pointer; }
    button:active { background: var(--z-viewer-pressed); }
    button:focus-visible { outline: 2px solid var(--z-viewer-text); outline-offset: 3px; }
    button:disabled { opacity: .25; cursor: default; }
    .viewer-header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left)); z-index: 2; }
    .viewer-header > div { min-width: 0; text-align: center; }
    .viewer-header-spacer { width: 44px; flex: none; }
    h1 { margin: 0; font-size: 16rem; font-weight: 600; }
    .viewer-header p { margin: 4px 0 0; color: var(--z-viewer-muted); font-size: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .viewer-header p:empty { display: none; }
    .viewer-stage { position: relative; min-height: 0; min-width: 0; touch-action: pinch-zoom; overflow: hidden; }
    .viewer-slide, .viewer-asset { position: absolute; inset: 0; }
    .viewer-asset img, .viewer-asset video { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; }
    .viewer-asset[hidden], .viewer-empty, .viewer-asset img[hidden], .viewer-asset video[hidden] { display: none; }
    .viewer-state a { color: inherit; }
    .viewer-asset video { touch-action: pinch-zoom; }
    .viewer-stage > button { position: absolute; top: calc(50% - 22px); z-index: 2; box-shadow: 0 1px 8px var(--z-viewer-shadow); }
    .viewer-previous { left: max(12px, env(safe-area-inset-left)); }
    .viewer-next { right: max(12px, env(safe-area-inset-right)); }
    .viewer-footer { text-align: center; padding: 12px max(24px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); }
    .viewer-footer p { margin: 0 0 6px; max-height: 15vh; overflow-y: auto; overscroll-behavior: contain; font-size: 14rem; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
    .viewer-footer time { font-size: 12rem; color: var(--z-viewer-muted); }
    .viewer-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; margin: 0; padding: 24px; font-size: 15rem; color: var(--z-viewer-muted); text-align: center; }
    .viewer-state p { margin: 0; }
    .viewer-state button { width: auto; padding-inline: 22px; border-radius: 22px; font-size: 14rem; }
    .viewer-state.loading { pointer-events: none; }
  }
`
