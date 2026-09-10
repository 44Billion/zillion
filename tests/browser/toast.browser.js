import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('reactive toast follows the real launcher locale, preserves queue behavior and fits the mobile column', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const files = await compile()
    const options = buildOptions({ development: true, onEnd: extra => files.push(...extra.filter(file => file.name !== '.well-known/napp.json')) })
    options.entryPoints = [{ in: 'tests/browser/toast-fixture.js', out: '__tests__/toast-fixture' }]
    options.entryNames = '[dir]/[name]'
    await esbuild.build(options)
    files.splice(files.findIndex(file => file.name === 'index.html'), 1, { name: 'index.html', bytes: new TextEncoder().encode('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/__tests__/toast-fixture.js"></script></head><body><z-toast-fixture></z-toast-fixture></body></html>') })
    const app = await prepareTestApp(files, { identifier: 'toast-test', name: 'Toast test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    const setLocale = locale => browser.evaluate(`(() => {
      const value = JSON.stringify(${JSON.stringify(locale)});
      localStorage.setItem('config_locale', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'config_locale', newValue: value, storageArea: localStorage }));
    })()`)
    await setLocale('pt-BR')
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    await browser.until(() => evaluate('Boolean(window.__toastTest && document.querySelector(".more")?.textContent.includes("Mais"))'), 'initial launcher locale')
    assert.equal(await evaluate('document.documentElement.lang'), 'pt-BR')
    await browser.until(() => evaluate('document.querySelectorAll(".preview").length === 11 && Boolean(document.querySelector(".contact-item[data-contact-id=daniel] .unread-badge"))'), 'home rows after route loading')
    assert.equal(await evaluate('document.querySelector(".preview").textContent'), 'Parece um plano perfeito ☀️')
    assert.equal(await evaluate('document.querySelector(".contact-item[data-contact-id=daniel] .unread-badge").getAttribute("aria-label")'), '1 mensagem não lida')
    await evaluate('__toastTest.success(__toastTest.translated, "<b>Details</b>")')
    await browser.until(() => evaluate('document.querySelector(".toast-card.is-open .toast-message")?.textContent === "Mais"'), 'reactive toast')
    assert.equal(await evaluate('document.querySelector(".toast-close").getAttribute("aria-label")'), 'Fechar')
    assert.equal(await evaluate('document.querySelector(".toast-long-text b")'), null)
    await evaluate('document.querySelector(".toast-long").click()')
    await browser.until(() => evaluate('document.querySelector(".toast-long").getAttribute("aria-expanded") === "true"'), 'expanded details')
    await setLocale('ja')
    await browser.until(() => evaluate('document.querySelector(".toast-message")?.textContent === "もっと見る"'), 'live toast translation')
    assert.equal(await evaluate('document.querySelector(".toast-close").getAttribute("aria-label")'), '閉じる')
    assert.equal(await evaluate('document.querySelector(".toast-long").getAttribute("aria-expanded")'), 'true')
    assert.equal(await evaluate('document.querySelector(".more span:last-child").textContent'), 'もっと見る')

    for (const locale of ['en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
      await setLocale(locale)
      await browser.until(() => evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`), `locale ${locale}`)
    }
    await evaluate('__toastTest.error("Second"); __toastTest.warning("Third"); __toastTest.error("Second")')
    await browser.until(() => evaluate('document.querySelector(".toast-message")?.textContent === "Second" && document.querySelector(".toast-counter")?.textContent === "3 / 3"'), 'unique queue, newest first')
    assert.equal(await evaluate('document.querySelector(".toast-nav-next").disabled'), true)
    await evaluate('document.querySelector(".toast-nav-prev").click()')
    await browser.until(() => evaluate('document.querySelector(".toast-message")?.textContent === "Third"'), 'previous message')
    assert.equal(await evaluate('document.querySelector(".toast-card").dataset.type'), 'warning')
    await evaluate('document.querySelector(".toast-nav-prev").click()')
    await browser.until(() => evaluate('document.querySelector(".toast-card").dataset.type === "success"'), 'oldest message')
    assert.equal(await evaluate('document.querySelector(".toast-nav-prev").disabled'), true)

    const pageSession = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    // Holding a toast pauses expiry while viewport and font preferences change.
    await evaluate('document.querySelector(".toast-message").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
    for (const width of [320, 390, 718, 1024]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: true }, pageSession)
      await delay(100)
      const rect = await evaluate(`(() => {
        const toast = document.querySelector('.toast-card').getBoundingClientRect();
        const home = document.querySelector('.home').getBoundingClientRect();
        return { width: toast.width, center: toast.left + toast.width / 2, homeCenter: home.left + home.width / 2, left: toast.left - home.left, right: home.right - toast.right, font: getComputedStyle(document.querySelector('.toast-message')).fontSize };
      })()`)
      assert.ok(rect.width <= 694 && rect.left >= 11 && rect.right >= 11, JSON.stringify({ viewport: width, ...rect }))
      assert.ok(Math.abs(rect.center - rect.homeCenter) < 1)
      assert.equal(rect.font, '16px')
    }
    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await browser.send('Page.setFontSizes', { fontSizes: { standard: 20 } }, appSession)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".toast-message")).fontSize'), '20px')
    assert.equal(await evaluate('document.querySelector(".home").getBoundingClientRect().width'), 718)
    await browser.send('Page.setFontSizes', { fontSizes: { standard: 16 } }, appSession)
    await delay(4200)
    assert.equal(await evaluate('Boolean(document.querySelector(".toast-card"))'), true)
    await evaluate('document.querySelector(".toast-card").dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))')
    await delay(4200)
    assert.equal(await evaluate('Boolean(document.querySelector(".toast-card"))'), true)
    await browser.until(() => evaluate('!document.querySelector(".toast-card")'), 'extended expiry', 5000)

    await evaluate('__toastTest.info("Fresh"); __toastTest.close(); __toastTest.show({type: "invalid", message: "Reopened"})')
    await browser.until(() => evaluate('document.querySelector(".toast-message")?.textContent === "Reopened"'), 'reopen during closing')
    await delay(400)
    assert.equal(await evaluate('document.querySelector(".toast-card").dataset.type'), 'info')
    assert.equal(await evaluate('document.querySelector(".toast-counter").textContent'), '1 / 1')
    await browser.until(() => evaluate('!document.querySelector(".toast-card")'), 'fresh short expiry', 5000)
    await evaluate('__toastTest.info("Unmount")')
    await browser.until(() => evaluate('Boolean(document.querySelector(".toast-card"))'), 'toast before unmount')
    await evaluate('__toastTest.view.mounted$(false)')
    await browser.until(() => evaluate('!document.querySelector("z-app")'), 'root unmount')
    await setLocale('fr')
    await evaluate('__toastTest.view.mounted$(true)')
    await browser.until(() => evaluate('document.querySelector(".more")?.textContent.includes("Plus")'), 'root remount follows current locale')
    assert.equal(await evaluate('document.querySelector(".toast-card")'), null)
    const appErrors = browser.logs.filter(log => log.method === 'Runtime.exceptionThrown' && log.sessionId === appSession)
    assert.deepEqual(appErrors, [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/toast'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
