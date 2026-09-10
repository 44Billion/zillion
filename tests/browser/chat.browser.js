import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('future feature flag controls home and chat previews without leaving empty space', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const widths = []
    for (const [development, futureFeatures, enabled] of [[true, false, false], [true, true, true], [false, true, false]]) {
      browser = await launchChrome()
      const app = await prepareTestApp(await compile({ development, futureFeatures }), { identifier: 'features-test', name: 'Future features test' })
      await browser.navigate('http://localhost:10000')
      await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
      const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, session)
      await browser.evaluate(app.installExpression)
      await browser.navigate(`http://localhost:10000/${app.app}`)
      const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
      const origin = new URL(appUrl).origin
      const evaluate = expression => browser.evaluate(expression, origin)
      await browser.until(() => evaluate('Boolean(document.querySelector(".contact-item[data-contact-id=maya]"))'), 'home')
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-header .actions button")].map(button => button.getAttribute("aria-label"))'), enabled ? ['Search messages', 'New message', 'Your profile'] : ['Your profile'])
      assert.equal(await evaluate('Boolean(document.querySelector(".contact-strip .more"))'), enabled)
      widths.push(await evaluate('document.querySelector(".contact-list").getBoundingClientRect().width'))
      await evaluate('document.querySelector(".contact-item[data-contact-id=maya]").click()')
      await browser.until(() => evaluate('Boolean(document.querySelector(".chat-more"))'), 'chat header')
      await browser.until(() => evaluate('!document.querySelector("[data-transitioning]")'), 'chat transition finished')
      assert.equal(await evaluate('Boolean(document.querySelector(".chat-attention"))'), enabled)
      assert.deepEqual(await evaluate('(() => { const rect = document.querySelector(".chat-header-actions").getBoundingClientRect(); return [rect.width, rect.height] })()'), [enabled ? 88 : 44, 44])
      await evaluate('document.querySelector(".chat-more").click()')
      await browser.until(() => evaluate('Boolean(document.querySelector(".chat-menu .delete-chat"))'), 'chat menu')
      assert.equal(await evaluate('Boolean(document.querySelector(".chat-attention-option"))'), enabled)
      await browser.until(() => evaluate('document.activeElement?.getAttribute("role") === "menuitem"'), 'menu focus')
      assert.equal(await evaluate('document.activeElement.innerText.trim()'), enabled ? 'Get attention' : 'Delete chat content')
      for (const text of ['', 'Draft', '']) {
        await evaluate(`(() => { const input = document.querySelector('.chat-composer textarea'); input.focus(); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
        const showMedia = enabled && !text
        await browser.until(() => evaluate(`document.querySelector('.compose-action').getAttribute('aria-label') === '${showMedia ? 'Camera' : 'Send message'}'`), 'composer action matches feature flag and draft')
        assert.equal(await evaluate('Boolean(document.querySelector(".attach"))'), showMedia)
        assert.equal(await evaluate('Boolean(document.querySelector(".compose-action icon-camera"))'), showMedia)
        assert.equal(await evaluate('Boolean(document.querySelector(".compose-action icon-send-2"))'), !showMedia)
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".composer-field")).outlineStyle'), 'solid')
      }
      await browser.close()
      browser = null
    }
    assert.equal(widths[0] - widths[1], 56, 'contacts reclaim the More button width and gap')
    assert.equal(widths[0], widths[2], 'production uses the full contact strip')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/future-features'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})

test('fixture DM routes, self chat, context actions and multiline composer in the real launcher', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const app = await prepareTestApp(await compile({ futureFeatures: true }), { identifier: 'chat-test', name: 'Chat preview test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    const pageSession = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, pageSession)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    await browser.until(() => evaluate('document.querySelectorAll(".contact-item").length === 11'), 'contacts including self')
    await evaluate('document.querySelector(".contact-item[data-contact-id=maya]").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 9'), 'fixture conversation')
    assert.equal(await evaluate('location.pathname'), '/chat/maya')
    assert.equal(await evaluate('document.querySelector(".chat-header h1").textContent'), 'Maya Chen')
    assert.equal(await evaluate('document.querySelector(".chat-header").getBoundingClientRect().height'), 48)
    assert.ok(await evaluate('[...document.querySelectorAll(".chat-header button")].every(button => button.getBoundingClientRect().height >= 44)'))
    await browser.until(() => evaluate('(() => {const el=document.querySelector(".chat-timeline");return el.scrollHeight-el.scrollTop-el.clientHeight < 2})()'), 'initial scroll to latest')
    assert.equal(await evaluate('document.querySelector(".message-actions")'), null)
    await evaluate('document.querySelector(".chat-more").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-menu [role=menuitem]").length === 1'), 'production chat options ignore the enabled feature flag')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".chat-menu button")].map(button => button.innerText.trim())'), ['Delete chat content'])
    assert.equal(await evaluate('document.querySelector(".chat-attention, .chat-attention-option")'), null)
    assert.deepEqual(await evaluate('(() => { const rect = document.querySelector(".chat-header-actions").getBoundingClientRect(); return [rect.width, rect.height] })()'), [44, 44])
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await browser.until(() => evaluate('!document.querySelector(".chat-menu")'), 'menu Escape dismissal')

    await evaluate('document.querySelector("[data-message-id=m9] .chat-bubble").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 300 }))')
    await browser.until(() => evaluate('document.querySelector(".message-actions")?.style.visibility === "visible"'), 'right click actions')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".message-actions button")].map(button=>button.getAttribute("aria-label"))'), ['Reply', 'Copy', 'Delete message'])
    assert.equal(await evaluate('Boolean(document.querySelector(".message-share icon-copy"))'), true)
    await evaluate('document.querySelector(".message-share").click()')
    await browser.until(() => evaluate('Boolean(document.querySelector(".message-share.copied icon-check"))'), 'clipboard success checkmark')
    assert.equal(await evaluate('document.querySelector(".message-share").innerText.trim()'), '')
    await browser.until(() => evaluate('!document.querySelector(".message-actions")'), 'copy feedback expires')

    // A moving touch must scroll without triggering the long press.
    await evaluate(`(() => {
      const el=document.querySelector('[data-message-id=m9] .chat-bubble');
      el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:400,bubbles:true}));
      el.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:50,clientY:420,bubbles:true}));
    })()`)
    await delay(600)
    assert.equal(await evaluate('document.querySelector(".message-actions")'), null)
    await evaluate('document.querySelector("[data-message-id=m9] .chat-bubble").dispatchEvent(new PointerEvent("pointerdown",{pointerId:2,pointerType:"touch",isPrimary:true,button:0,clientX:50,clientY:400,bubbles:true}))')
    await browser.until(() => evaluate('document.querySelector(".message-actions")?.style.visibility === "visible"'), 'stationary long press')
    await evaluate('document.querySelector("[data-message-id=m9] .chat-bubble").dispatchEvent(new PointerEvent("pointerup",{pointerId:2,pointerType:"touch",bubbles:true}))')
    const bounds = await evaluate(`(() => {
      const actions=document.querySelector('.message-actions').getBoundingClientRect();
      const bubble=document.querySelector('[data-message-id=m9] .chat-bubble').getBoundingClientRect();
      return { top:actions.top,bubbleTop:bubble.top,right:actions.right,bottom:actions.bottom,width:innerWidth,height:innerHeight };
    })()`)
    assert.ok(bounds.top < bounds.bubbleTop && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height)
    const gutterHit = await evaluate(`(() => {
      const row = document.querySelector('[data-message-id=m9]');
      const rect = row.getBoundingClientRect();
      const target = document.elementFromPoint(rect.right - 1, rect.bottom - 1);
      const isGutter = target?.closest('.message-row') === row && !target.closest('.chat-bubble, .message-actions');
      if (isGutter) target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      return isGutter;
    })()`)
    assert.equal(gutterHit, true)
    await browser.until(() => evaluate('!document.querySelector(".message-actions")'), 'empty space beside the selected bubble dismisses actions')

    await evaluate('document.querySelector(".chat-composer textarea").focus()')
    assert.equal(await evaluate(`(() => {
      const field = document.querySelector('.composer-field');
      const input = field.querySelector('textarea');
      return !input.value && !field.querySelector('.attach') && getComputedStyle(field).outlineStyle === 'solid' && getComputedStyle(input).outlineStyle === 'none';
    })()`), true)

    const setText = text => evaluate(`(() => {const el=document.querySelector('.chat-composer textarea');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await setText('One')
    await browser.until(() => evaluate('Boolean(document.querySelector(".compose-action icon-send-2")) && !document.querySelector(".attach")'), 'typing toggles controls')
    await evaluate('document.querySelector(".chat-composer textarea").focus()')
    const inputSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, inputSession)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, inputSession)
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").value.includes("\\n")'), 'Enter inserts a newline')
    await setText('One\nTwo\nThree\nFour\nFive')
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").clientHeight >= 140'), 'five visible lines')
    const five = await evaluate('document.querySelector(".chat-composer textarea").clientHeight')
    await setText('One\nTwo\nThree\nFour\nFive\nSix\nSeven')
    await browser.until(() => evaluate('getComputedStyle(document.querySelector(".chat-composer textarea")).overflowY === "auto"'), 'internal scroll after five lines')
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").clientHeight'), five)
    const bottoms = await evaluate('Array.from(document.querySelectorAll(".composer-field, .compose-action"),el=>el.getBoundingClientRect().bottom)')
    assert.ok(Math.abs(bottoms[0] - bottoms[1]) < 1)
    await setText('')
    await browser.until(() => evaluate('!document.querySelector(".attach") && Boolean(document.querySelector(".compose-action icon-send-2"))'), 'empty production composer keeps Send')
    assert.equal(await evaluate('document.querySelectorAll(".chat-bubble").length'), 9)

    for (const width of [320, 718, 1024]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: true }, pageSession)
      await delay(100)
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
      assert.ok(await evaluate('document.querySelector(".chat-screen").getBoundingClientRect().width <= 718'))
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, pageSession)
    await evaluate('document.querySelector(".chat-back").click()')
    await browser.until(() => evaluate('location.pathname === "/" && Boolean(document.querySelector(".home"))'), 'back to home')
    await evaluate('document.querySelector(".conversation [data-contact-id=user]").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 3'), 'self DM')
    assert.equal(await evaluate('document.querySelector(".chat-header h1").textContent'), 'You')
    assert.equal(await evaluate('document.querySelectorAll(".incoming").length'), 0)
    await evaluate('history.back()')
    await browser.until(() => evaluate('location.pathname === "/"'), 'browser Back')
    await evaluate('history.forward()')
    await browser.until(() => evaluate('location.pathname === "/chat/user" && Boolean(document.querySelector(".chat-screen"))'), 'browser Forward')

    await evaluate('location.href="/chat/maya?entry=1"')
    await browser.until(() => evaluate('Boolean(document.querySelector(".entry-logo img"))'), 'direct entry chat')
    await evaluate('document.querySelector(".chat-back").click()')
    assert.equal(await evaluate('location.pathname + location.search'), '/chat/maya?entry=1')
    assert.equal(await evaluate('document.querySelector(".home")'), null)
    await evaluate('location.reload()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 9 && Boolean(document.querySelector(".entry-logo"))'), 'direct route reload')

    await browser.evaluate('localStorage.setItem(\'config_locale\', JSON.stringify(\'pt-BR\')); window.dispatchEvent(new StorageEvent(\'storage\', { key: \'config_locale\', newValue: JSON.stringify(\'pt-BR\'), storageArea: localStorage }))')
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").placeholder === "Mensagem"'), 'chat follows launcher locale')
    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    for (const theme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, appSession)
      await evaluate('document.querySelector("[data-message-id=m9] .chat-bubble").dispatchEvent(new MouseEvent("contextmenu", { bubbles:true,cancelable:true,clientX:50,clientY:400 }))')
      await browser.until(() => evaluate('document.querySelector(".message-actions")?.style.visibility === "visible"'), 'screenshot actions')
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await delay(500)
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, pageSession)
      await mkdir(path.join(root, 'tmp/chat-preview'), { recursive: true })
      await writeFile(path.join(root, `tmp/chat-preview/${theme}.png`), Buffer.from(data, 'base64'))
    }
    await evaluate('location.href="/chat/missing?entry=1"')
    await browser.until(() => evaluate('Boolean(document.querySelector(".chat-missing"))'), 'unknown contact')
    assert.equal(await evaluate('document.querySelectorAll(".chat-missing button").length'), 0)
    const exceptions = browser.logs.filter(log => log.method === 'Runtime.exceptionThrown' && log.sessionId === appSession)
    assert.deepEqual(exceptions, [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/chat'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
