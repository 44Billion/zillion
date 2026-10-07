import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('contacts preview navigation, search, responsive strip and unsaved DM', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ demo: true, onEnd: result => { files = result } })
    options.plugins.push({
      name: 'contacts-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/route-driver.js"\nimport "../../tests/browser/fixtures/contacts-probe.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'contacts-test', name: 'Contacts preview test' })
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
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(active + selector)}).click()`)
    const ready = selector => browser.until(() => evaluate(`(() => {
      const route = window.testNavigation?.route$();
      const page = document.querySelector('.route-page[data-active=true]');
      return route && page?.dataset.routeId === route.uid + ':' + route.url.pathname + route.url.search && Boolean(page.querySelector(${JSON.stringify(selector)})) && !document.querySelector('[data-transitioning]');
    })()`), selector)
    const query = async text => {
      await evaluate(`(() => { const input = document.querySelector('${active}input'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    await ready('.home .more')
    assert.equal(await evaluate(`document.querySelector('${active}.contact-list').scrollLeft`), 0, 'startup shows the left edge')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, session)
    const localPoint = await evaluate(`(() => {const r=document.querySelector('${active}.contact-list').getBoundingClientRect();return {x:r.right-30,y:r.top+25}})()`)
    const frameOffset = await browser.evaluate(`(() => {const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src.startsWith('${origin}'));const r=frame.getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    const point = { x: localPoint.x + frameOffset.x, y: localPoint.y + frameOffset.y }
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, session)
    // Let Chrome process each native input frame instead of coalescing an
    // entire zero-duration drag before it can begin scrolling.
    for (let n = 1; n <= 4; n++) {
      await new Promise(resolve => setTimeout(resolve, 25))
      await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x - n * 25, y: point.y, id: 1 }] }, session)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session)
    await browser.until(() => evaluate(`(() => {
      const list=document.querySelector('${active}.contact-list');const step=parseFloat(getComputedStyle(list).getPropertyValue('--contact-step'));
      return list.scrollLeft>1 && getComputedStyle(list).scrollSnapType==='x mandatory' && Math.abs(list.scrollLeft/step-Math.round(list.scrollLeft/step))<.02;
    })()`), 'native touch activates snap and settles on a contact')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)
    await evaluate(`window.initialHomeList=document.querySelector('${active}.contact-list');window.initialHomeLeft=initialHomeList.scrollLeft`)
    await click('.home .more')
    await ready('.contacts-screen')
    assert.equal(await evaluate('location.pathname'), '/contacts')
    const names = await evaluate(`Array.from(document.querySelectorAll('${active}.person-name'), e => e.textContent)`)
    assert.deepEqual(names.slice(1), ['Alex Kim', 'Daniel Costa', 'Ellie Parker', 'James Wilson', 'Juliette Roux', 'Matteo Rossi', 'Maya Chen', 'Nina Patel', 'Sam Taylor', 'Sofia Martins'])
    await evaluate('testNavigation.back()')
    await ready('.home .more')
    assert.equal(await evaluate(`document.querySelector('${active}.contact-list')===initialHomeList`), true)
    assert.ok(await evaluate('Math.abs(initialHomeList.scrollLeft-initialHomeLeft)<1'), 'returning home preserves manual scroll')
    await click('.home .more')
    await ready('.contacts-screen')
    await query('daNiel')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.contact-row').length`), 1)
    await click('[data-person-id=daniel]')
    await ready('.chat-header')
    assert.equal(await evaluate('location.pathname'), '/chat/daniel')
    await click('.chat-back')
    await ready('.contacts-screen')
    assert.equal(await evaluate(`document.querySelector('${active}input').value`), 'daNiel')
    await click('.add-contact')
    await ready('.contacts-screen')
    assert.equal(await evaluate('location.pathname'), '/contacts/add')
    assert.equal(await evaluate(`document.activeElement === document.querySelector('${active}input')`), true)
    await query('luna@')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.contact-row').length`), 0)
    await query('luna@example.com')
    await ready('[data-person-id=luna]')
    await click('[data-person-id=luna]')
    await ready('.contact-invitation')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.chat-composer, ${active}.compose-action, ${active}.chat-bubble').length`), 0)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${active}.chat-header')).position`), 'absolute')
    await click('.contact-invitation button')
    await browser.until(() => evaluate('document.body.textContent.includes("Adding contacts is not available yet.")'), 'unavailable feedback')
    await click('.chat-back')
    await ready('[data-person-id=luna]')
    await evaluate('testNavigation.forward()')
    await ready('.contact-invitation')
    await evaluate('location.reload()')
    await ready('.contact-invitation')
    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await mkdir(path.join(root, 'tmp/contacts-preview'), { recursive: true })
    for (const theme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, appSession)
      for (const [route, selector] of [['/contacts', '.contacts-screen'], ['/contacts/add', '.contacts-screen'], ['/chat/luna', '.contact-invitation']]) {
        await evaluate(`testNavigation.replaceState({}, '', ${JSON.stringify(route)})`)
        await ready(selector)
        if (route === '/contacts/add') { await query('luna@example.com'); await ready('[data-person-id=luna]') }
        await browser.until(() => evaluate(`Array.from(document.querySelectorAll('${active}img')).some(img => img.naturalWidth > 0 && img.getBoundingClientRect().width >= 40)`), 'visible portrait')
        const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, session)
        await writeFile(path.join(root, `tmp/contacts-preview/${theme}-${route.split('/').at(-1)}.png`), Buffer.from(data, 'base64'))
      }
    }
    await evaluate('testNavigation.replaceState({}, "", "/contacts/add");')
    await ready('.contacts-screen')
    await evaluate('location.reload()')
    await ready('.contacts-screen')
    assert.equal(await evaluate(`document.activeElement === document.querySelector('${active}input')`), true)
    await evaluate('(() => { const host = document.createElement("div"); host.innerHTML = "<z-contacts-probe></z-contacts-probe>"; document.querySelector("z-router").append(host); })()')
    await browser.until(() => evaluate('Boolean(document.querySelector(".strip-probe .add-contact"))'), 'partial strip')
    assert.equal(await evaluate('Boolean(document.querySelector(".strip-probe .more"))'), false)
    await evaluate('contactStripProbe.setCount(5)')
    await browser.until(() => evaluate('Boolean(document.querySelector(".strip-probe .more"))'), 'full strip')
    assert.equal(await evaluate('Boolean(document.querySelector(".strip-probe .add-contact"))'), false)
    await evaluate('document.querySelector(".strip-probe").style.width = "718px"')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await browser.until(() => evaluate('Boolean(document.querySelector(".strip-probe .add-contact"))'), 'wide strip')
    const gap = await evaluate('(() => { const last = [...document.querySelectorAll(\'.strip-probe .contact-item\')].at(-1).getBoundingClientRect(); const add = document.querySelector(\'.strip-probe .add-contact\').getBoundingClientRect(); return add.left - last.right; })()')
    assert.ok(Math.abs(gap) < 1)
    await evaluate('document.querySelector(".strip-probe").style.width="390px";contactStripProbe.start()')
    await browser.until(() => evaluate('document.querySelectorAll(".strip-probe .contact-item").length===1'), 'startup self only')
    await evaluate('contactStripProbe.grow()')
    await browser.until(() => evaluate('document.querySelectorAll(".strip-probe .contact-item").length===25'), 'startup contact batch')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.equal(await evaluate('document.querySelector(".strip-probe .contact-list").scrollLeft'), 0, 'inserting before self cannot move to the end')
    assert.equal(await evaluate('document.querySelector(".strip-probe .contact-item").dataset.contactId'), 'probe-0')
    await evaluate('contactStripProbe.sort()')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.equal(await evaluate('document.querySelector(".strip-probe .contact-list").scrollLeft'), 0, 'first alphabetical sort stays at the left edge')
    await evaluate('document.querySelector(".strip-probe .contact-list").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))')
    await browser.until(() => evaluate('document.querySelector(".strip-probe .contact-list").scrollLeft>40'), 'keyboard scroll remains available')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".strip-probe .contact-list")).scrollSnapType'), 'x mandatory')
    await evaluate('document.querySelector(".strip-probe .contact-list").dispatchEvent(new WheelEvent("wheel",{deltaX:100,bubbles:true,cancelable:true}))')
    await browser.until(() => evaluate('document.querySelector(".strip-probe .contact-list").scrollLeft>90'), 'wheel scroll remains available')
    await evaluate('contactStripProbe.grow()')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await evaluate('document.querySelector(".strip-probe .contact-list").scrollLeft>1'), 'data updates never reset manually chosen scroll')
    await evaluate('contactStripProbe.setCount(0)')
    await browser.until(() => evaluate('document.querySelectorAll(".strip-probe .contact-item").length === 0'), 'empty strip')
    await evaluate('document.querySelector(".strip-probe .add-contact").click()')
    await ready('.contacts-screen')
    assert.equal(await evaluate('location.pathname'), '/contacts/add')
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown' && log.sessionId === appSession), [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/contacts'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
