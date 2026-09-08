import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../44billion/tests/browser/runtime/prepare-app.js'

test('home contacts snap, load nearby avatars, share unread counts, and scroll under the header', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const app = await prepareTestApp(await compile(), { identifier: 'home-test', name: 'Home layout test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 600, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'home iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    await browser.until(() => evaluate('document.querySelectorAll(".contact-item").length === 10 && document.querySelectorAll(".contact-item img").length > 0'), 'home contacts')
    const names = await evaluate('[...document.querySelectorAll(".contact-item .contact-name")].map(el => el.textContent)')
    assert.deepEqual(names, ['Daniel', 'Ellie', 'Maya', 'Alex', 'James', 'Juliette', 'Matteo', 'Nina', 'Sam', 'Sofia'])
    assert.equal(await evaluate('document.querySelectorAll(".contact-pin").length'), 3)
    assert.equal(await evaluate('document.querySelectorAll(".contact-item img").length < 10'), true)
    assert.equal(await evaluate('Boolean([...document.querySelectorAll(".contact-item")].at(-1).querySelector("img"))'), false)
    const counts = await evaluate(`(() => {
      const contacts = [...document.querySelectorAll('.contact-item')].filter(el => el.querySelector('.unread-badge')).map(el => [el.querySelector('.contact-name').textContent, el.querySelector('.unread-badge').innerText.trim()]);
      const conversations = [...document.querySelectorAll('.conversation')].filter(el => el.querySelector('.unread-badge')).map(el => [el.querySelector('.name').textContent.split(' ')[0], el.querySelector('.unread-badge').innerText.trim()]);
      return {contacts: contacts.sort(), conversations: conversations.sort()};
    })()`)
    assert.deepEqual(counts.contacts, counts.conversations)

    for (const theme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, session)
      for (const context of browser.contexts.values()) {
        if (context.origin === origin && context.auxData?.isDefault) {
          await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, context.sessionId)
        }
      }
      const badges = await evaluate(`Array.from(document.querySelectorAll('.unread-badge'), el => {
        const style = getComputedStyle(el);
        const luminance = color => color.match(/[0-9.]+/g).slice(0, 3).map(Number).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return {size: parseFloat(style.fontSize), height: el.getBoundingClientRect().height, lightText: a > b, contrast: (Math.max(a,b) + .05) / (Math.min(a,b) + .05)};
      })`)
      for (const badge of badges) {
        assert.equal(badge.size, 11)
        assert.equal(badge.height, 20)
        assert.equal(badge.lightText, theme === 'light')
        assert.ok(badge.contrast >= 4.5)
      }
    }

    const moreLeft = await evaluate('document.querySelector(".more").getBoundingClientRect().left')
    const step = await evaluate('parseFloat(document.querySelector(".contact-list").style.getPropertyValue("--contact-step"))')
    await evaluate('document.querySelector(".contact-list").dispatchEvent(new WheelEvent("wheel", {deltaY: 100, bubbles: true, cancelable: true}))')
    await browser.until(() => evaluate(`Math.abs(document.querySelector('.contact-list').scrollLeft - ${step}) < 1`), 'one smooth wheel step')
    assert.equal(await evaluate('scrollY'), 0)
    assert.equal(await evaluate('document.querySelector(".more").getBoundingClientRect().left'), moreLeft)
    await evaluate('document.querySelector(".contact-list").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft", bubbles:true, cancelable:true}))')
    await browser.until(() => evaluate('document.querySelector(".contact-list").scrollLeft < 1'), 'keyboard scroll back')

    // Exercise the browser's snap algorithm from an offset between contacts.
    await evaluate(`document.querySelector('.contact-list').scrollTo({left: ${step * 3.4}, behavior: 'smooth'})`)
    await browser.until(() => evaluate(`Math.abs(document.querySelector('.contact-list').scrollLeft - ${step * 3}) < 1`), 'native scrolling settles on a whole contact')
    assert.equal(await evaluate('document.querySelector(".more").getBoundingClientRect().left'), moreLeft)
    await evaluate('document.querySelector(".contact-list").scrollTo({left: 10000, behavior: "instant"})')
    await browser.until(() => evaluate('Boolean([...document.querySelectorAll(".contact-item")].at(-1).querySelector("img")?.naturalWidth)'), 'newly revealed avatar')

    await evaluate('window.scrollTo(0, 220)')
    const sticky = await evaluate(`(() => {
      const header = document.querySelector('.home-header').getBoundingClientRect();
      const divider = document.querySelector('.contacts-divider').getBoundingClientRect();
      const contacts = document.querySelector('.contact-strip').getBoundingClientRect();
      return {top:header.top, bottom:header.bottom, divider:divider.top, contacts:contacts.bottom};
    })()`)
    assert.ok(Math.abs(sticky.top) < 1)
    assert.ok(Math.abs(sticky.divider - sticky.bottom) < 1)
    assert.ok(sticky.contacts <= sticky.bottom)
    for (const width of [320, 718, 1024]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: true }, session)
      await browser.until(() => evaluate('(() => { const list = document.querySelector(\'.contact-list\'); const step = parseFloat(list.style.getPropertyValue(\'--contact-step\')); return Math.abs(list.clientWidth / step - Math.round(list.clientWidth / step)) < .03 })()'), 'whole contacts after resize')
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
      assert.ok(await evaluate('document.querySelector(".home").getBoundingClientRect().width <= 718'))
    }
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/home'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
