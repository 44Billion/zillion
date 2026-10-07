// Reuse the real launcher/vault bootstrap while keeping this scenario in its
// own guarded browser unit, separate from feedback and pause regressions.
process.env.ZILLION_SEND_LATENCY_ONLY = '1'
await import('./send-feedback.browser.js')
