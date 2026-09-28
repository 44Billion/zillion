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

  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const key = async (name, code, modifiers = 0) => {
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, browser.sessionId)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers }, browser.sessionId)
    await settle()
  }
  const openMenu = async () => {
    await evaluate('document.querySelector(".language-trigger").click()')
    await browser.until(() => evaluate('document.activeElement.getAttribute("role") === "menuitemradio"'), 'menu focus')
    await settle()
  }
  const choose = async value => {
    await openMenu()
    await evaluate(`document.querySelector('.language-option[data-locale="${value}"]').click()`)
    await browser.until(() => evaluate('document.documentElement.lang').then(lang => lang === (value === 'auto' ? 'pt-BR' : value)), 'locale ' + value)
    await settle()
    assert.equal(await evaluate('document.querySelector(".language-trigger").getAttribute("aria-expanded")'), 'false')
    assert.equal(await evaluate('document.activeElement.className'), 'language-trigger')
  }
  const { identifier: languagesScript } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'Object.defineProperty(navigator, \'languages\', { configurable: true, get: () => [\'xx\', \'pt-PT\', \'en-US\'] })'
  }, browser.sessionId)
  await viewport(1440)
  await media('light')
  await ready(origin + '/zillion/')
  assert.equal(await evaluate('document.documentElement.lang'), 'pt-BR')
  assert.equal(await evaluate('document.querySelector(\'.language-option[aria-checked="true"]\').dataset.locale'), 'auto')
  assert.equal(await evaluate('document.querySelector(".launch-label strong").textContent'), 'Abrir Zillion')
  assert.equal(await evaluate('typeof window.napp'), 'undefined')
  await screenshot('i18n-pt-desktop-light')
  const mouseClick = async selector => {
    const { x, y } = await evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, browser.sessionId)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, browser.sessionId)
    await settle()
  }
  await mouseClick('.language-trigger')
  await browser.until(() => evaluate('document.activeElement.getAttribute("role") === "menuitemradio"'), 'pointer menu focus')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".language-trigger")).outlineStyle'), 'none')
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'auto')
  assert.equal(await evaluate('document.querySelectorAll(".language-option[aria-checked=true]").length'), 1)
  await screenshot('language-menu-desktop-light')
  await media('dark')
  await screenshot('language-menu-desktop-dark')
  await key('End', 35)
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'ko')
  await key('ArrowDown', 40)
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'auto')
  await key('ArrowUp', 38)
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'ko')
  await key('Home', 36)
  await key('f', 70)
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'fr')
  await key('Escape', 27)
  assert.equal(await evaluate('document.activeElement.className'), 'language-trigger')
  assert.equal(await evaluate('document.querySelector(".language-menu").hidden'), true)
  assert.equal(await evaluate('document.documentElement.lang'), 'pt-BR', 'navigation alone does not change the language')
  await key('ArrowDown', 40)
  await browser.until(() => evaluate('document.activeElement.getAttribute("role") === "menuitemradio"'), 'arrow opens menu')
  await key('Tab', 9)
  assert.equal(await evaluate('document.activeElement.className'), 'theme-control')
  assert.equal(await evaluate('document.querySelector(".language-menu").hidden'), true)
  await openMenu()
  await key('Tab', 9, 8)
  assert.equal(await evaluate('document.activeElement.className'), 'language-trigger')
  assert.equal(await evaluate('document.querySelector(".language-menu").hidden'), true)
  await openMenu()
  await mouseClick('.theme-control')
  assert.equal(await evaluate('document.querySelector(".language-menu").hidden'), true)
  assert.equal(await evaluate('document.activeElement.className'), 'theme-control', 'outside click keeps its focus')
  // Restore automatic theme before checking every translated theme label.
  await evaluate('document.querySelector(".theme-control").click(); document.querySelector(".theme-control").click()')
  await settle()
  for (const width of [320, 390, 768, 1440]) {
    await viewport(width, 480)
    await openMenu()
    await browser.until(() => evaluate(`(() => {
      const r = document.querySelector('.language-menu').getBoundingClientRect();
      return r.left >= 11 && r.right <= innerWidth - 11 && r.top >= 11 && r.bottom <= innerHeight - 11;
    })()`), 'menu fits viewport ' + width)
    await key('End', 35)
    assert.equal(await evaluate(`(() => {
      const menu = document.querySelector('.language-menu').getBoundingClientRect();
      const item = document.activeElement.getBoundingClientRect();
      return item.top >= menu.top && item.bottom <= menu.bottom;
    })()`), true, 'last language is reachable ' + width)
    if (width === 390) await screenshot('language-menu-mobile-dark')
    await key('Escape', 27)
  }
  await viewport(320, 480)
  await media('light')
  await evaluate('document.documentElement.style.fontSize = "1.25px"')
  await openMenu()
  await screenshot('language-menu-mobile-large-text')
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  await key('Escape', 27)
  await evaluate('document.documentElement.style.removeProperty("font-size")')
  await viewport(1440)
  console.log('PASS: themed menu, pointer focus, arrows, Home/End, typeahead, Escape, Tab, outside dismissal and viewport bounds')
  const locales = ['en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']
  for (const locale of locales) {
    await choose(locale)
    assert.equal(await evaluate('document.querySelector(\'.language-option[aria-checked="true"]\').dataset.locale'), locale)
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
  assert.equal(await evaluate('document.querySelector(\'.language-option[aria-checked="true"]\').dataset.locale'), 'fr')
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
  await browser.until(() => evaluate('document.querySelector(\'.language-option[aria-checked="true"]\').dataset.locale').then(value => value === 'auto'), 'cleared preferences')
  assert.equal(await evaluate('document.querySelector(\'.language-option[aria-checked="true"]\').dataset.locale'), 'auto')
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
  await openMenu()
  await key('Home', 36)
  assert.equal(await evaluate('document.activeElement.dataset.locale'), 'auto')
  await key('Enter', 13)
  await browser.until(() => evaluate('document.documentElement.lang').then(value => value === 'en'), 'keyboard language selection')
  assert.equal(await evaluate('document.activeElement.className'), 'language-trigger')
  await openMenu()
  await key('End', 35)
  await key(' ', 32)
  await browser.until(() => evaluate('document.documentElement.lang').then(value => value === 'ko'), 'Space selects a language')
  await settle()
  assert.equal(await evaluate('document.activeElement.className'), 'language-trigger')
  await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked }, browser.sessionId)
  assert.deepEqual(errors, [])
  assert.ok(requests.every(url => new URL(url).origin === origin))
  console.log('PASS: keyboard selection, blocked storage, unsupported-language fallback, both URL roots, no errors or external requests')
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
