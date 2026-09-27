import translations from '../../landing/src/i18n/locales.json' with { type: 'json' }
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
const root = path.resolve('landing/dist')
const requests = []
const errors = []
const server = createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/zillion(?=\/)/, '')
    if (pathname.endsWith('/')) pathname += 'index.html'
    const file = path.resolve(root, '.' + pathname)
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path')
    const bytes = await readFile(file)
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream')
    res.end(bytes)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://localhost:' + server.address().port
let browser
try {
  browser = await launchChrome({
    intercept: req => {
      requests.push(req.url)
      return new URL(req.url).origin === origin ? null : false
    }, onEvent: e => {
      if (e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Network.responseReceived' && e.params.response.status >= 400)) errors.push(e)
    }
  })
  const evaluate = expression => browser.evaluate(expression, origin)
  const media = theme => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, browser.sessionId)
  const viewport = (width, height = 900) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 721 }, browser.sessionId)
  const ready = async url => {
    await browser.navigate(url)
    await browser.until(() => evaluate('!!document.querySelector(".roadmap")'), 'landing render')
    await browser.until(() => evaluate('[...document.images].every(img => img.complete && img.naturalWidth > 0)'), 'all images')
  }
  const screenshot = async name => {
    await mkdir('tmp/landing-review', { recursive: true })
    const { cssContentSize } = await browser.send('Page.getLayoutMetrics', {}, browser.sessionId)
    const { data } = await browser.send('Page.captureScreenshot', { format: 'webp', quality: 85, captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } }, browser.sessionId)
    await writeFile('tmp/landing-review/' + name + '.webp', Buffer.from(data, 'base64'))
    console.log(name + ': ' + JSON.stringify(cssContentSize))
  }

  const choose = async value => {
    await evaluate(`(() => {
      const select = document.querySelector('.language-control select');
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await browser.until(() => evaluate('document.documentElement.lang').then(lang => lang === (value === 'auto' ? 'pt-BR' : value)), 'locale ' + value)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const { identifier: languagesScript } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'Object.defineProperty(navigator, \'languages\', { configurable: true, get: () => [\'xx\', \'pt-PT\', \'en-US\'] })'
  }, browser.sessionId)
  await viewport(1440)
  await media('light')
  await ready(origin + '/zillion/')
  assert.equal(await evaluate('document.documentElement.lang'), 'pt-BR')
  assert.equal(await evaluate('document.querySelector(".language-control select").value'), 'auto')
  assert.equal(await evaluate('document.querySelector(".launch-label strong").textContent'), 'Abrir Zillion')
  assert.equal(await evaluate('typeof window.napp'), 'undefined')
  await screenshot('i18n-pt-desktop-light')
  const locales = ['en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']
  for (const locale of locales) {
    await choose(locale)
    assert.equal(await evaluate('document.querySelector(".language-control select").value'), locale)
    assert.equal(await evaluate('document.querySelector(".theme-control").getAttribute("aria-label")'), translations['Theme: {{current}}. Switch to {{next}}.'][locale].replace('{{current}}', translations.Auto[locale]).replace('{{next}}', translations.Light[locale]))
    assert.equal(await evaluate('document.title'), translations['Zillion — Privacy runs deeper.'][locale])
    assert.equal(await evaluate('document.querySelector("meta[name=description]").content'), translations['Private messaging on Nostr, protected by two keys working together. No download required.'][locale])
    assert.equal(await evaluate('document.querySelector(".roadmap h3").textContent'), translations['Identity misuse alerts'][locale])
    assert.equal(await evaluate('document.querySelector(".key-art").getAttribute("aria-label")'), translations['A purple identity key and a green content key join to protect one conversation. Both keys are needed.'][locale])
    await evaluate('document.querySelector("details").open = true')
    for (const width of [320, 390, 720, 768, 1024, 1440]) {
      await viewport(width)
      const overflow = await evaluate(`(() => {
        return [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.skip-link') && !el.closest('svg');
        }).map(el => [el.tagName, el.className, el.getBoundingClientRect().right]);
      })()`)
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'overflow ' + locale + ' ' + width + ': ' + JSON.stringify(overflow))
    }
    await evaluate('document.querySelector("details").open = false')
    if (['pt-BR', 'de', 'ja'].includes(locale)) {
      await media('dark')
      await viewport(1440)
      await screenshot('i18n-' + locale + '-desktop-dark')
      await viewport(390)
      await screenshot('i18n-' + locale + '-mobile-dark')
      await media('light')
      await screenshot('i18n-' + locale + '-mobile-light')
    }
    await viewport(320)
    await evaluate('document.documentElement.style.fontSize = "1.25px"')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'large text ' + locale)
    await evaluate('document.documentElement.style.removeProperty("font-size")')
  }
  console.log('PASS: all 11 locales update text, metadata, accessible names and fit 320–1440px, including larger text')
  await choose('fr')
  await ready(origin + '/')
  assert.equal(await evaluate('document.documentElement.lang'), 'fr')
  assert.equal(await evaluate('document.querySelector(".language-control select").value'), 'fr')
  await evaluate('document.querySelector(".theme-control").click()')
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light')
  await choose('auto')
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light')
  await evaluate('Object.defineProperty(navigator, \'languages\', { configurable: true, get: () => [\'zh-HK\'] }); dispatchEvent(new Event(\'languagechange\'))')
  await browser.until(() => evaluate('document.documentElement.lang').then(value => value === 'zh-TW'), 'live browser language')
  await choose('de')
  await evaluate('Object.defineProperty(navigator, \'languages\', { configurable: true, get: () => [\'ja\'] }); dispatchEvent(new Event(\'languagechange\'))')
  assert.equal(await evaluate('document.documentElement.lang'), 'de')
  await evaluate('dispatchEvent(new StorageEvent(\'storage\', { key: \'zillion:landing:locale\', newValue: \'ko\' }))')
  await browser.until(() => evaluate('document.documentElement.lang').then(value => value === 'ko'), 'cross-tab locale')
  await evaluate('dispatchEvent(new StorageEvent(\'storage\', { key: null, newValue: null }))')
  await browser.until(() => evaluate('document.querySelector(".language-control select").value').then(value => value === 'auto'), 'cleared preferences')
  assert.equal(await evaluate('document.querySelector(".language-control select").value'), 'auto')
  await evaluate('localStorage.setItem(\'zillion:landing:locale\', \'invalid\')')
  await ready(origin + '/')
  assert.equal(await evaluate('document.documentElement.lang'), 'pt-BR')
  await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: languagesScript }, browser.sessionId)
  console.log('PASS: automatic language priorities, Chinese variants, persistence, languagechange, cross-tab updates and invalid stored values')
  const { identifier: blocked } = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, \'localStorage\', { get() { throw new Error(\'Storage unavailable\') } }); Object.defineProperty(navigator, \'languages\', { get: () => [\'ar\'] })' }, browser.sessionId)
  await ready(origin + '/')
  assert.equal(await evaluate('document.documentElement.lang'), 'en')
  await choose('es')
  assert.equal(await evaluate('document.querySelector(".launch-label strong").textContent'), 'Abrir Zillion')
  await evaluate('document.querySelector(".language-control select").focus()')
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }, browser.sessionId)
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }, browser.sessionId)
  await browser.until(() => evaluate('document.documentElement.lang').then(value => value === 'en'), 'native keyboard language selection')
  assert.equal(await evaluate('document.activeElement.tagName'), 'SELECT')
  await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked }, browser.sessionId)
  assert.deepEqual(errors, [])
  assert.ok(requests.every(url => new URL(url).origin === origin))
  console.log('PASS: keyboard selection, blocked storage, unsupported-language fallback, both URL roots, no errors or external requests')
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
