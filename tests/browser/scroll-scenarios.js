import assert from 'node:assert/strict'

// Runs in the real self-chat document. Only the media HTTP responses are held;
// history, encryption, permissions, routing and component updates remain real.
export async function checkScrollScenarios ({ browser, evaluate, addNote, media }) {
  const previousIds = await evaluate('[...document.querySelectorAll(".message-row")].map(row => row.dataset.messageId)')
  const timestamp = Math.floor(Date.now() / 1000) + 60
  await evaluate('window.savedChatDates = [...document.querySelectorAll(".message-list .chat-date")]')
  media.reject = true
  for (let i = 0; i < 24; i++) await addNote(`Scroll fixture ${i}\nhttps://example.com/scroll-${i}.png${i === 23 ? '#dim=1x1' : ''}`, timestamp + i)
  await addNote('Scroll fixture final marker', timestamp + 25)
  await browser.until(() => evaluate('[...document.querySelectorAll(".message-row .chat-content")].filter(content => content.innerText.startsWith("Scroll fixture ")).length === 25'), 'scroll history persisted', 60000)
  const expectedIds = await evaluate('[...document.querySelectorAll(".message-row")].map(row => row.dataset.messageId)')
  assert.ok(previousIds.every(id => expectedIds.includes(id)), 'history remains present while scroll fixtures arrive')
  assert.equal(new Set(expectedIds).size, expectedIds.length, 'history and live delivery have no duplicate bubbles')
  assert.ok(await evaluate('savedChatDates.every(date => date.isConnected)'), 'new messages preserve existing date nodes')
  // A document reload retains the app version and real event store. No restore.
  media.reject = false
  media.stagger = true
  await evaluate('window.scrollReloadMarker = true')
  await browser.evaluate(`(() => {
    const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(media.origin)});
    const url = new URL(frame.src); url.pathname = '/'; frame.src = url.href;
  })()`)
  await browser.until(() => evaluate('!window.scrollReloadMarker && !!document.querySelector(\'.conversation [data-contact-id=user]\')'), 'fresh chat document')
  await evaluate('document.querySelector(\'.conversation [data-contact-id=user]\').click()')
  await browser.until(() => evaluate('!!document.querySelector(".chat-timeline")'), 'chat timeline remounted')
  await browser.until(() => evaluate('document.querySelector(".chat-timeline")?.dataset.initialLoading === "true"'), 'initial media phase')
  await evaluate(`(() => {
    const timeline = document.querySelector('.chat-timeline');
    window.scrollProbe = { firstRenderedAt: null, settledAt: null, records: [], gaps: [], animations: 0, animatedMessages: [], dates: {}, dateReplacements: 0, simultaneous: 0 };
    const record = type => {
      if (type === 'initial' && timeline.dataset.initialLoading === 'false') scrollProbe.settledAt = performance.now();
      if (scrollProbe.records.length < 150) scrollProbe.records.push({type, initial:timeline.dataset.initialLoading, history:timeline.dataset.historyLoaded, expected:selfChatAccount.messages$().length, error:selfChatAccount.error$(), top:timeline.scrollTop, gap:timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight, rows:timeline.querySelectorAll('.message-row').length, pending:[...timeline.querySelectorAll('[data-chat-prepared="false"]')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>0&&b.top<timeline.clientHeight}).length});
    };
    timeline.addEventListener('scroll',()=>record('scroll'));
    new MutationObserver(()=>record('initial')).observe(timeline,{attributes:true,attributeFilter:['data-initial-loading']});
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.classList.contains('message-growth')) {
        record('animation');
        scrollProbe.animations++;
        scrollProbe.animatedMessages.push(this.closest('.message-row')?.dataset.messageId);
        scrollProbe.simultaneous = Math.max(scrollProbe.simultaneous, this.getAnimations().length);
      }
      return animation;
    };
    window.scrollProbe.restore = () => { Element.prototype.animate = original; };
    const sample = () => {
      if (scrollProbe.stopped) return;
      if (scrollProbe.firstRenderedAt === null && timeline.querySelector('.message-row')) scrollProbe.firstRenderedAt = performance.now();
      scrollProbe.gaps.push(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight);
      for (const date of timeline.querySelectorAll('.chat-date[data-day]')) {
        if (scrollProbe.dates[date.dataset.day] && scrollProbe.dates[date.dataset.day] !== date) scrollProbe.dateReplacements++;
        scrollProbe.dates[date.dataset.day] = date;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`)
  await browser.until(() => evaluate(`document.querySelector('.chat-timeline').dataset.historyLoaded === 'true' && selfChatAccount.messages$().length === ${Math.min(50, expectedIds.length)}`), 'scroll history recovered', 60000)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="#dim=1x1"]\')'), 'bounded image rendered after snapshot')
  const reserved = await evaluate('document.querySelector(\'.chat-media a[href$="#dim=1x1"]\').nextElementSibling.getBoundingClientRect().height')
  assert.ok(reserved > 0, '#dim has a bounded media box')
  media.stagger = false
  await browser.until(() => evaluate('document.querySelectorAll(".chat-media img[src]").length > 0'), 'visible history images prepared')
  await browser.until(() => evaluate('document.querySelector(".chat-timeline").dataset.initialLoading === "false"'), 'initial media phase completed')
  await evaluate('scrollProbe.stopped = true')
  if (await evaluate('scrollProbe.animations')) console.log('Initial settle diagnostic', JSON.stringify(await evaluate('scrollProbe.records')))
  assert.equal(await evaluate('scrollProbe.animations'), 0, 'initial history never animates')
  assert.equal(await evaluate('scrollProbe.dateReplacements'), 0, 'date separators retain their DOM identity throughout initial loading')
  assert.ok(await evaluate('scrollProbe.gaps.every(gap => Math.abs(gap) <= 2)'), `bottom stays pinned throughout enrichment: ${JSON.stringify(await evaluate('scrollProbe.gaps.filter(gap => Math.abs(gap) > 2).slice(0, 10)'))}`)

  console.log('Scroll: initial history remains pinned without growth animation', await evaluate('({messages: document.querySelectorAll(".message-row").length, firstFrameToStableMs: scrollProbe.settledAt - scrollProbe.firstRenderedAt})'))

  // A newly inserted resource animates while staying pinned to the bottom.
  media.hold = true
  await addNote('New media\nhttps://example.com/scroll-live.png', timestamp + 30)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-live.png"]\')'), 'new media link')
  media.hold = false
  await media.release()
  await browser.until(() => evaluate('scrollProbe.animations > 0'), 'live media growth animates')
  await browser.until(() => evaluate('!document.querySelector(".chat-timeline").getAnimations({subtree:true}).length'), 'growth finishes')
  assert.ok(await evaluate('Math.abs(document.querySelector(".chat-timeline").scrollHeight - document.querySelector(".chat-timeline").scrollTop - document.querySelector(".chat-timeline").clientHeight) <= 2'))

  // Read older messages while another resource above them expands.
  media.hold = true
  await addNote('Earlier late media\nhttps://example.com/scroll-earlier.png', timestamp - 1)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-earlier.png"]\')'), 'earlier media link')
  // Start preparation while visible, then move away before the held response.
  // Offscreen resources that were never visited are intentionally left unloaded.
  await evaluate('document.querySelector(\'.chat-media a[href$="scroll-earlier.png"]\').scrollIntoView({block:"center"})')
  await browser.until(() => media.pending > 0, 'visible earlier media requested')
  await evaluate(`(() => {
    const timeline = document.querySelector('.chat-timeline');
    const row = document.querySelector('.chat-media a[href$="scroll-12.png"]').closest('.message-row');
    timeline.dispatchEvent(new WheelEvent('wheel', {deltaY:-400, bubbles:true}));
    timeline.scrollTop += row.getBoundingClientRect().top - timeline.getBoundingClientRect().top - 59;
    window.readingRow = row;
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  const top = await evaluate('readingRow.getBoundingClientRect().top')
  const animations = await evaluate('scrollProbe.animations')
  const earlierId = await evaluate('document.querySelector(\'.chat-media a[href$="scroll-earlier.png"]\').closest(".message-row").dataset.messageId')
  media.hold = false
  await media.release()
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-earlier.png"]\').nextElementSibling.querySelector("img")'), 'offscreen media loaded')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const afterGrowth = await evaluate('readingRow.getBoundingClientRect().top')
  assert.ok(Math.abs(afterGrowth - top) <= 2, `reading position survives growth above the viewport (${top} -> ${afterGrowth})`)
  assert.equal(await evaluate(`scrollProbe.animatedMessages.includes(${JSON.stringify(earlierId)})`), false, 'offscreen growth does not animate')

  // Prepending within an already displayed day must not replace its separator.
  await evaluate('window.savedChatDates = [...document.querySelectorAll(".message-list .chat-date")]')
  await addNote('Older date-owner regression', timestamp - 3600)
  await browser.until(() => evaluate('selfChatAccount.older$().hasOlder || selfChatAccount.messages$().some(message => message.content === "Older date-owner regression")'), 'backfill is available live or through pagination')
  await evaluate('(async () => { while (selfChatAccount.older$().hasOlder && !selfChatAccount.messages$().some(message => message.content === "Older date-owner regression")) { if (!await selfChatAccount.loadOlder()) throw new Error("Older page failed"); } })()')
  await browser.until(() => evaluate('document.querySelector(".chat-timeline").textContent.includes("Older date-owner regression")'), 'older message inserted')
  assert.ok(await evaluate('savedChatDates.every(date => date.isConnected)'), 'earlier messages preserve the date nodes')

  // An old, visible offline miss may animate after the initial phase.
  media.hold = true
  await addNote('Old visible media\nhttps://example.com/scroll-old-visible.png', timestamp + 12)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-old-visible.png"]\')'), 'old visible media link')
  await evaluate('document.querySelector(\'.chat-media a[href$="scroll-old-visible.png"]\').scrollIntoView({block:"center"})')
  await new Promise(resolve => setTimeout(resolve, 100))
  media.hold = false
  await media.release()
  await browser.until(() => evaluate(`scrollProbe.animations > ${animations}`), 'old visible media animates after initial loading')
  await browser.until(() => evaluate('!document.querySelector(".chat-timeline").getAnimations({subtree:true}).length'), 'old media growth finishes')

  await evaluate(`(() => {
    const timeline = document.querySelector('.chat-timeline');
    timeline.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}));
    timeline.scrollTop = timeline.scrollHeight;
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  media.hold = true
  const beforePair = await evaluate('scrollProbe.animations')
  await addNote('Overlapping enrichment\nhttps://example.com/scroll-pair-a.png\nhttps://example.com/scroll-pair-b.png', timestamp + 40)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-pair-b.png"]\')'), 'paired media links')
  await new Promise(resolve => setTimeout(resolve, 100))
  media.hold = false
  await media.release()
  await browser.until(() => evaluate(`scrollProbe.animations >= ${beforePair + 2}`), 'successive enrichment retargets growth')
  await browser.until(() => evaluate('!document.querySelector(".chat-timeline").getAnimations({subtree:true}).length'), 'paired growth finishes')
  assert.equal(await evaluate('scrollProbe.simultaneous'), 1, 'a message never accumulates growth animations')
  assert.ok(await evaluate('[...document.querySelectorAll(".message-growth")].every(el => !el.style.height && !el.style.overflow)'), 'animation completion releases layout styles')

  const context = [...browser.contexts.values()].find(context => context.origin === new URL(media.origin).origin && context.auxData?.isDefault)
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, context.sessionId)
  const beforeReduced = await evaluate('scrollProbe.animations')
  await addNote('Reduced motion\nhttps://example.com/scroll-reduced.png', timestamp + 41)
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-reduced.png"]\').nextElementSibling.querySelector("img")'), 'reduced motion image')
  assert.equal(await evaluate('scrollProbe.animations'), beforeReduced, 'reduced motion suppresses growth')
  await browser.send('Emulation.setEmulatedMedia', { features: [] }, context.sessionId)

  console.log('Scroll: reading anchor, overlapping growth and reduced motion verified')
  const beforeNavigation = await evaluate('document.querySelector(".chat-timeline").scrollTop')
  await evaluate('document.querySelector(".chat-back").click()')
  await browser.until(() => evaluate('location.pathname === "/"'), 'leave chat')
  await evaluate('history.forward()')
  await browser.until(() => evaluate('location.pathname === "/chat/user"'), 'return to retained chat')
  assert.equal(await evaluate('document.querySelector(".chat-timeline").dataset.initialLoading'), 'false')
  assert.ok(Math.abs(await evaluate('document.querySelector(".chat-timeline").scrollTop') - beforeNavigation) <= 2)
  await evaluate('scrollProbe.restore()')
  console.log('Scroll: retained route and position verified')
}
