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
  await evaluate('location.reload()')
  await browser.until(() => evaluate('!!document.querySelector(".chat-timeline")'), 'chat timeline remounted')
  await browser.until(() => evaluate('document.querySelector(".chat-timeline")?.dataset.initialLoading === "true"'), 'initial media phase')
  await evaluate(`(() => {
    const timeline = document.querySelector('.chat-timeline');
    window.scrollProbe = { gaps: [], animations: 0, dates: {}, dateReplacements: 0, simultaneous: 0 };
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.classList.contains('message-growth')) {
        scrollProbe.animations++;
        scrollProbe.simultaneous = Math.max(scrollProbe.simultaneous, this.getAnimations().length);
      }
      return animation;
    };
    window.scrollProbe.restore = () => { Element.prototype.animate = original; };
    const sample = () => {
      if (scrollProbe.stopped) return;
      scrollProbe.gaps.push(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight);
      for (const date of timeline.querySelectorAll('.chat-date[data-day]')) {
        if (scrollProbe.dates[date.dataset.day] && scrollProbe.dates[date.dataset.day] !== date) scrollProbe.dateReplacements++;
        scrollProbe.dates[date.dataset.day] = date;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`)
  await browser.until(() => evaluate(`document.querySelector('.chat-timeline').dataset.historyLoaded === 'true' && ${JSON.stringify(expectedIds)}.every(id => document.querySelector('[data-message-id="' + id + '"]'))`), 'scroll history recovered', 60000)
  const reserved = await evaluate('document.querySelector(\'.chat-media a[href$="#dim=1x1"]\').nextElementSibling.getBoundingClientRect().height')
  assert.ok(reserved > 0, '#dim has a bounded media box')
  media.stagger = false
  await browser.until(() => evaluate('document.querySelectorAll(".chat-media img[src]").length >= 24'), 'history images prepared')
  await browser.until(() => evaluate('document.querySelector(".chat-timeline").dataset.initialLoading === "false"'), 'initial media phase completed')
  await evaluate('scrollProbe.stopped = true')
  assert.equal(await evaluate('scrollProbe.animations'), 0, 'initial history never animates')
  assert.equal(await evaluate('scrollProbe.dateReplacements'), 0, 'date separators retain their DOM identity throughout initial loading')
  assert.ok(await evaluate('scrollProbe.gaps.every(gap => Math.abs(gap) <= 2)'), `bottom stays pinned throughout enrichment: ${JSON.stringify(await evaluate('scrollProbe.gaps.filter(gap => Math.abs(gap) > 2).slice(0, 10)'))}`)

  console.log('Scroll: initial history remains pinned without growth animation')

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
  await evaluate(`(() => {
    const timeline = document.querySelector('.chat-timeline');
    const row = document.querySelector('.chat-media a[href$="scroll-12.png"]').closest('.message-row');
    timeline.dispatchEvent(new WheelEvent('wheel', {deltaY:-400, bubbles:true}));
    timeline.scrollTop += row.getBoundingClientRect().top - timeline.getBoundingClientRect().top - 100;
    window.readingRow = row;
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  const top = await evaluate('readingRow.getBoundingClientRect().top')
  const animations = await evaluate('scrollProbe.animations')
  media.hold = false
  await media.release()
  await browser.until(() => evaluate('!!document.querySelector(\'.chat-media a[href$="scroll-earlier.png"]\').nextElementSibling.querySelector("img")'), 'offscreen media loaded')
  assert.ok(Math.abs(await evaluate('readingRow.getBoundingClientRect().top') - top) <= 2, 'reading position survives growth above the viewport')
  assert.equal(await evaluate('scrollProbe.animations'), animations, 'offscreen growth does not animate')

  // Prepending within an already displayed day must not replace its separator.
  await evaluate('window.savedChatDates = [...document.querySelectorAll(".message-list .chat-date")]')
  await addNote('Older date-owner regression', timestamp - 3600)
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
