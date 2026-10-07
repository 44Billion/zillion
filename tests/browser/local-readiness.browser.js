// A separate guarded browser keeps the locked-startup regression within 3 GiB.
process.env.ZILLION_LOCAL_READINESS_ONLY = '1'
await import('./send-feedback.browser.js')
