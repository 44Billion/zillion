import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('profile preview, local controls, editing, identity sharing and retained chat navigation', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
    options.plugins.push({
      name: 'profile-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/route-driver.js"\nimport "../../tests/browser/fixtures/profile-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'profile-test', name: 'Profile preview test' })
    browser = await launchChrome()
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const origin = new URL(url).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    const active = '.route-page[data-active=true] '
    const click = async selector => {
      await ready(selector)
      await evaluate(`document.querySelector(${JSON.stringify(active + selector)}).click()`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    const ready = selector => browser.until(() => evaluate(`(() => {
      const route = window.testNavigation?.route$();
      const page = document.querySelector('.route-page[data-active=true]');
      return route && page?.dataset.routeId === route.uid + ':' + route.url.pathname + route.url.search && Boolean(page.querySelector(${JSON.stringify(selector)})) && !document.querySelector('[data-transitioning]');
    })()`), selector)
    const read = selector => evaluate(`document.querySelector(${JSON.stringify(active + selector)}).textContent.trim()`)
    const push = async (url, selector = '.profile-screen') => { await evaluate(`testNavigation.pushState({}, '', ${JSON.stringify(url)})`); await ready(selector) }
    const shareMode = mode => evaluate(`(() => {
      window.shared = []; window.copies = [];
      Object.defineProperty(document, 'permissionsPolicy', { configurable: true, value: { allowsFeature: () => true } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { ${mode === 'error' ? "throw new Error('Clipboard unavailable')" : 'copies.push(text)'}; } } });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: ${['copy', 'error'].includes(mode) ? 'undefined' : `async data => { ${mode === 'cancel' ? "throw new DOMException('Cancelled', 'AbortError')" : 'shared.push(data)'}; }`} });
    })()`)
    await ready('.home')
    await evaluate('profileTest.setOwn({ display_name: "Own display", name: "own", nip05: "own@example.com", about: "Account biography" })')
    await shareMode('copy')
    await click('.home-header button[aria-label="Your profile"]')
    await ready('.profile-screen')
    assert.equal(await evaluate('location.pathname'), '/profile/user')
    assert.equal(await read('.profile-name'), 'Own display')
    assert.equal(await evaluate(`Boolean(document.querySelector('${active}.contact-toggle'))`), false)
    await click('.pin-toggle')
    await click('.profile-share')
    await browser.until(() => evaluate(`document.querySelector('${active}.profile-share').dataset.copied === 'true'`), 'copy feedback')
    assert.deepEqual(await evaluate('copies'), ['own@example.com'])
    await click('.edit-profile')
    await ready('.profile-editor')
    assert.equal(await evaluate('location.pathname'), '/profile/user/edit')
    assert.equal(await evaluate(`document.querySelector('${active}.profile-save').disabled`), true)
    assert.equal(await evaluate(`document.querySelectorAll('${active}.media-actions button:disabled').length`), 2)
    await evaluate(`(() => { const input = document.querySelector('${active}input[name=display_name]'); input.value = 'Local draft'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await click('.profile-back')
    await ready('.profile-screen')
    assert.equal(await read('.profile-name'), 'Own display')
    assert.equal(await evaluate(`document.querySelector('${active}.pin-toggle').getAttribute('aria-pressed')`), 'true')
    await evaluate('testNavigation.forward()')
    await ready('.profile-editor')
    assert.equal(await evaluate(`document.querySelector('${active}input[name=display_name]').value`), 'Local draft')
    assert.equal(await evaluate('profileTest.profile().display_name'), 'Own display')

    await push('/chat/daniel', '.chat-screen')
    await evaluate(`(() => { const input = document.querySelector('${active}.chat-composer textarea'); input.value = 'Keep this chat draft'; input.dispatchEvent(new Event('input', { bubbles: true })); window.savedChat = document.querySelector('${active}.chat-screen'); savedChat.querySelector('.chat-timeline').scrollTop = 30; window.chatTop = savedChat.querySelector('.chat-timeline').scrollTop; })()`)
    const headerGeometry = await evaluate(`['.chat-header', '.chat-avatar', '.chat-name'].map(selector => { const r = document.querySelector('${active}' + selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })`)
    await click('.chat-avatar')
    await ready('.profile-screen')
    assert.equal(await evaluate('location.pathname'), '/profile/daniel')
    await click('.contact-toggle')
    assert.equal(await evaluate(`Boolean(document.querySelector('${active}.pin-toggle'))`), false)
    await click('.contact-toggle')
    await browser.until(() => evaluate(`document.querySelector('${active}.pin-toggle')?.getAttribute('aria-pressed') === 'false'`), 'removal clears pin')
    await click('.profile-back')
    await ready('.chat-screen')
    assert.equal(await evaluate(`document.querySelector('${active}.chat-screen') === savedChat`), true)
    assert.equal(await evaluate(`document.querySelector('${active}.chat-composer textarea').value`), 'Keep this chat draft')
    assert.equal(await evaluate('savedChat.querySelector(".chat-timeline").scrollTop'), await evaluate('chatTop'))
    assert.deepEqual(await evaluate(`['.chat-header', '.chat-avatar', '.chat-name'].map(selector => { const r = document.querySelector('${active}' + selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })`), headerGeometry)

    await push('/chat/luna', '.contact-invitation')
    await shareMode('share')
    await click('.contact-profile .profile-avatar')
    await ready('.profile-screen')
    assert.equal(await evaluate('location.pathname'), '/profile/luna')
    assert.equal(await evaluate(`Boolean(document.querySelector('${active}.pin-toggle'))`), false)
    await click('.profile-share')
    await browser.until(() => evaluate('shared.length === 1'), 'native share')
    assert.deepEqual(await evaluate('shared'), [{ text: 'luna@example.com' }])
    await shareMode('cancel')
    await click('.profile-share')
    await browser.until(() => evaluate(`!document.querySelector('${active}.profile-share').disabled`), 'share cancelled')
    assert.deepEqual(await evaluate('copies'), [])
    await click('.contact-toggle')
    await click('.pin-toggle')
    await click('.profile-back')
    await ready('.contact-invitation')
    assert.equal(await evaluate(`Boolean(document.querySelector('${active}.chat-composer'))`), false)
    await evaluate('testNavigation.forward()')
    await ready('.profile-screen')
    assert.equal(await evaluate(`document.querySelector('${active}.pin-toggle').getAttribute('aria-pressed')`), 'true')
    await evaluate('location.reload()')
    await ready('.profile-screen')
    assert.equal(await evaluate(`Boolean(document.querySelector('${active}.pin-toggle'))`), false)

    await shareMode('copy')
    await push('/profile/sam')
    assert.equal(await read('.profile-name'), 'No name')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${active}.profile-name')).fontStyle`), 'italic')
    assert.ok((await read('.identifier-text')).includes('…'))
    await click('.profile-share')
    await browser.until(() => evaluate('copies.length === 1'), 'npub copied')
    assert.equal(await evaluate('copies[0]'), await evaluate(`document.querySelector('${active}.identifier-text').title`))
    await shareMode('error')
    await evaluate('window.originalCopy = document.execCommand; document.execCommand = () => false')
    await click('.profile-share')
    await browser.until(() => evaluate('document.querySelector("z-toast")?.textContent.includes("Could not copy identifier")'), 'copy error')
    await evaluate('document.execCommand = originalCopy; document.querySelector(".toast-close").click()')
    await browser.until(() => evaluate('!document.querySelector(".toast-card")'), 'toast dismissed')

    await push('/profile/maya')
    await ready('.profile-cover')
    await ready('.bio-more')
    const initialHeight = await evaluate(`document.querySelector('${active}.bio-text').clientHeight`)
    await click('.expand-bio')
    await browser.until(() => evaluate(`document.querySelector('${active}.bio-text').clientHeight > ${initialHeight}`), 'bio expands')
    for (let n = 0; n < 10 && await evaluate(`Boolean(document.querySelector('${active}.bio-more'))`); n++) {
      await click('.expand-bio')
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    assert.equal(await evaluate(`document.querySelector('${active}.expand-bio').disabled`), true)
    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await mkdir(path.join(root, 'tmp/profile-preview'), { recursive: true })
    await evaluate('profileTest.setOwn({ display_name: "Arthur", name: "arthur", nip05: "arthur@example.com", about: "Fotografia, tecnologia e boas conversas." }); profileTest.locale("pt-BR")')
    for (const theme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, appSession)
      for (const route of ['/profile/maya', '/profile/luna', '/profile/sam', '/profile/user/edit']) {
        await push(route)
        if (route.endsWith('maya')) await ready('.profile-cover')
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, session)
        await writeFile(path.join(root, `tmp/profile-preview/${theme}-${route.split('/').at(-1)}.png`), Buffer.from(data, 'base64'))
      }
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: true }, session)
    const longIdentifier = 'long-identifier-'.repeat(10) + '@example.com'
    await evaluate(`profileTest.setOwn({ nip05: ${JSON.stringify(longIdentifier)} })`)
    await push('/profile/user')
    await shareMode('copy')
    await click('.profile-share')
    await browser.until(() => evaluate('copies.length === 1'), 'long identifier copied')
    assert.equal(await evaluate('copies[0]'), longIdentifier)
    assert.equal(await evaluate(`(() => { const e = document.querySelector('${active}.profile-screen'); return e.scrollWidth <= e.clientWidth; })()`), true)
    await evaluate('profileTest.setOwn({ banner: "data:image/png;base64,AAAA" }, null)')
    await push('/profile/user')
    await browser.until(() => evaluate(`document.querySelector('${active}.profile-share')?.disabled`), 'missing identity')
    assert.equal(await evaluate(`document.querySelector('${active}.profile-portrait').dataset.banner`), 'false')
    for (const width of [320, 718]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: true }, session)
      await push('/profile/sam')
      assert.equal(await evaluate(`(() => { const e = document.querySelector('${active}.profile-screen'); return e.scrollWidth <= e.clientWidth; })()`), true)
    }
    await evaluate('location.href = "/profile/user/edit"')
    await ready('.profile-editor')
    await click('.profile-back')
    await ready('.profile-screen')
    assert.equal(await evaluate('location.pathname'), '/profile/user')
    await evaluate('location.href = "/profile/missing"')
    await ready('.profile-screen')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.profile-actions').length`), 0)
    await click('.profile-back')
    await ready('.home')
    assert.equal(await evaluate('location.pathname'), '/')
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown'), [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/profile'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
