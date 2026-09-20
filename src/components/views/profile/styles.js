export const profileStyles = `
  .profile-screen {
    min-height: 100svh; padding-bottom: max(32px, env(safe-area-inset-bottom)); background: var(--z-surface);
    @media (min-width: 719px) { border-inline: 1px solid var(--z-border); }
    button { cursor: pointer; }
    button:disabled { cursor: default; }
    .profile-content { padding-inline: 24px; }
    .profile-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
    .profile-action { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1 1 130px;
      min-height: 48px; padding: 12px; border: 1px solid var(--z-border); border-radius: 14px;
      background: var(--z-control); color: var(--z-text); font-size: 14rem; font-weight: 550; }
    .profile-action:active:not(:disabled) { background: var(--z-pressed); }
    .profile-action.primary { background: var(--z-primary); color: var(--z-on-primary); border-color: transparent; }
    .profile-action.primary:active { opacity: .8; }
    .profile-action[aria-pressed=true] { color: var(--z-accent-text); }
    .profile-action > * { flex: none; }
    .profile-action span { flex: initial; overflow-wrap: anywhere; }
    .profile-hint { margin: 14px 0 0; font-size: 12rem; line-height: 1.5; color: var(--z-muted); text-align: center; }
  }
`
