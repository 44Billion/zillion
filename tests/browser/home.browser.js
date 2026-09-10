import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

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
    await browser.until(() => evaluate('document.querySelectorAll(".contact-item").length === 11 && document.querySelectorAll(".contact-item img").length > 0'), 'home contacts')
    await browser.until(() => evaluate('Boolean(document.querySelector(".brand-logo img")?.naturalWidth)'), 'local logo image')
    const logoPixels = await evaluate(`(() => {
      const img = document.querySelector('.brand-logo img');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 256, 256);
      const { data } = ctx.getImageData(0, 0, 256, 256);
      let left = 256, right = 0;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        if (data[(y * 256 + x) * 4 + 3] >= 16) { left = Math.min(left, x); right = Math.max(right, x); }
      }
      return { cornerAlpha: data[3], fraction: (right - left + 1) / 256, icon: document.querySelector('link[rel=icon]').href, source: img.src };
    })()`)
    assert.equal(logoPixels.cornerAlpha, 0)
    assert.ok(Math.abs(logoPixels.fraction - 0.8) < 0.01)
    assert.equal(logoPixels.icon, logoPixels.source)
    const names = await evaluate('[...document.querySelectorAll(".contact-item .contact-name")].map(el => el.textContent)')
    assert.deepEqual(names, ['Daniel', 'Ellie', 'Maya', 'Alex', 'You', 'James', 'Juliette', 'Matteo', 'Nina', 'Sam', 'Sofia'])
    assert.equal(await evaluate('document.querySelectorAll(".contact-pin").length'), 3)
    assert.equal(await evaluate('document.querySelectorAll(".contact-item img").length < 11'), true)
    assert.equal(await evaluate('Boolean([...document.querySelectorAll(".contact-item")].at(-1).querySelector("img"))'), false)
    await browser.until(() => evaluate(`(() => {
      const list = document.querySelector('.contact-list').getBoundingClientRect();
      const near = [...document.querySelectorAll('.contact-item')].find(item => {
        const rect = item.getBoundingClientRect();
        return rect.left >= list.right && rect.left < list.right + 84;
      });
      return Boolean(near?.querySelector('img')?.naturalWidth);
    })()`), 'avatar preloaded beyond the visible scroller edge')
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

    const measureHeader = async scroll => evaluate(`(async () => {
      window.scrollTo(0, ${scroll});
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const header = document.querySelector('.home-header');
      const rect = header.getBoundingClientRect();
      const style = getComputedStyle(header);
      const logo = document.querySelector('.brand-logo').getBoundingClientRect();
      const contacts = document.querySelector('.home-contacts-space').getBoundingClientRect();
      const divider = document.querySelector('.contacts-divider').getBoundingClientRect();
      const conversation = document.querySelector('.conversation').getBoundingClientRect();
      return {
        top: rect.top, height: rect.height, bottom: rect.bottom, scroll: scrollY,
        logoWidth: logo.width, logoHeight: logo.height,
        titleOpacity: Number(getComputedStyle(document.querySelector(".home-header h1")).opacity),
        paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
        paddingInline: parseFloat(style.paddingLeft),
        brandGap: parseFloat(getComputedStyle(document.querySelector('.brand')).gap),
        divider: divider.top, border: divider.height, contactsBottom: contacts.bottom,
        conversationTop: conversation.top + scrollY, extent: document.documentElement.scrollHeight
      };
    })()`)
    const expanded = await measureHeader(0)
    const threshold = expanded.contactsBottom - expanded.height
    const before = await measureHeader(threshold - 1)
    const touching = await measureHeader(threshold)
    const partial = await measureHeader(threshold + 48)
    const compact = await measureHeader(threshold + 96)
    assert.equal(before.height, expanded.height)
    assert.equal(before.logoWidth, expanded.logoWidth)
    assert.ok(before.divider > before.bottom)
    assert.equal(touching.height, expanded.height)
    assert.ok(Math.abs(touching.divider - touching.bottom) < 1)
    assert.ok(partial.height < expanded.height && partial.height > compact.height)
    assert.equal(compact.height + compact.border, 48)
    assert.ok(compact.logoHeight < expanded.logoHeight)
    assert.equal(compact.logoHeight, 28)
    const imageWidth = await evaluate('document.querySelector(".brand-logo img").getBoundingClientRect().width')
    assert.ok(Math.abs(imageWidth * logoPixels.fraction - 28) < 0.5)
    assert.equal(expanded.titleOpacity, 1)
    assert.equal(before.titleOpacity, 1)
    assert.equal(touching.titleOpacity, 1)
    assert.equal(partial.titleOpacity, 0.5)
    assert.equal(compact.titleOpacity, 0)
    assert.equal(partial.scroll, threshold + 48)
    assert.equal(compact.scroll, threshold + 96)
    for (const state of [partial, compact]) {
      assert.ok(Math.abs(state.top) < 1)
      assert.ok(Math.abs(state.divider - state.bottom) < 1)
      assert.ok(Math.abs(state.logoWidth - state.logoHeight) < 0.1)
      assert.equal(state.conversationTop, expanded.conversationTop)
      assert.equal(state.extent, expanded.extent)
    }
    for (const key of ['height', 'logoWidth', 'titleOpacity', 'paddingTop', 'paddingBottom', 'paddingInline', 'brandGap']) {
      assert.ok(Math.abs((expanded[key] - partial[key]) / (expanded[key] - compact[key]) - 0.5) < 0.02, `${key} reaches its minimum at the same scroll position`)
    }
    const hitAreas = await evaluate('Array.from(document.querySelectorAll(".home-header button"), button => button.getBoundingClientRect().height)')
    assert.ok(hitAreas.every(height => height >= 44))
    assert.equal(await evaluate('Boolean(document.elementFromPoint(100, 65)?.closest(".conversation"))'), true)
    const beyond = await measureHeader(threshold + 130)
    assert.equal(beyond.height, compact.height)
    assert.equal(beyond.titleOpacity, 0)
    assert.ok(Math.abs(beyond.divider - beyond.bottom) < 1)
    const reversing = await measureHeader(threshold + 48)
    assert.equal(reversing.height, partial.height)
    assert.equal(reversing.logoHeight, partial.logoHeight)
    assert.equal(reversing.titleOpacity, partial.titleOpacity)
    const restored = await measureHeader(0)
    assert.equal(restored.height, expanded.height)
    assert.equal(restored.logoHeight, expanded.logoHeight)
    assert.equal(restored.titleOpacity, 1)
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
