import assert from 'node:assert/strict'

export async function checkHistoryScenarios ({ browser, evaluate, pubkey }) {
  await evaluate(`void (async () => {
    const at = Math.floor(Date.now() / 1000) - 100;
    const jobs = Array.from({length: 235}, (_, i) => ({kind:9, created_at:at, tags:[], content:'Paged note '+String(i).padStart(3,'0')}));
    for (let i=0; i<jobs.length; i+=4) await Promise.all(jobs.slice(i,i+4).map(event => window.napp.eventStore.addPersonalCopy(event, {context:'dm:'+${JSON.stringify(pubkey)}})));
    window.historySeeded=true;
  })().catch(error=>{window.historySeedError=error.message})`)
  await browser.until(() => evaluate('if(window.historySeedError)throw new Error(window.historySeedError);window.historySeeded'), '235 real personal copies seeded', 240000)
  const origin = await evaluate('location.origin')
  await browser.evaluate(`(() => {
    const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
    const url = new URL(frame.src); url.pathname = '/'; frame.src = url.href;
  })()`)
  await browser.until(() => evaluate('!window.historySeeded && !!document.querySelector(\'.conversation [data-contact-id=user]\')'), 'fresh history document')
  // Automatic near-top prefetch may start immediately after the initial page.
  // Hold those requests so the 25-copy opening is a stable, observable boundary.
  await evaluate('controlHistoryPaging()')
  try {
    await evaluate('document.querySelector(\'.conversation [data-contact-id=user]\').click()')
    await browser.until(() => evaluate('window.selfChatAccount?.historyState$() === "loaded" && document.querySelector(".chat-timeline")?.dataset.initialLoading === "false"'), '25-message opening', 60000)
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 25)
    await evaluate('settleHistoryLayout()')
    assert.equal(await evaluate('document.querySelectorAll(".chat-timeline [data-message-id]").length'), 25)
    if (!process.argv.includes('--skip-measurement')) {
      await browser.until(() => evaluate('selfChatAccount.summaries$()[selfChatAccount.pubkey$()]?.state === "loaded"'), 'summary reader idle before comparison', 120000)
      await evaluate('void window.measureChatHistory().then(value=>window.historyMeasurements=value).catch(error=>window.historyMeasureError=error.message)')
      const measurements = await browser.until(() => evaluate('if(window.historyMeasureError)throw new Error(window.historyMeasureError);window.historyMeasurements'), 'real vault measurements', 240000)
      console.log('Real vault history measurements:', JSON.stringify(measurements))
      for (const measured of measurements) {
        assert.equal(measured.decryptions, 25)
        assert.ok(measured.maxConcurrent <= measured.concurrency && measured.maxConcurrent > 1)
        assert.equal(measured.queries, 0)
        assert.ok(measured.firstMessageMs < measured.totalMs)
      }
    }
    await evaluate('(() => { const input=document.querySelector(\'.chat-composer textarea\'); input.value=\'Preserved draft\'; input.dispatchEvent(new Event(\'input\',{bubbles:true})); })()')
    await evaluate('settleHistoryLayout()')
    await evaluate('historyPaging.arm()')
    await evaluate(`(() => {
    const timeline=document.querySelector('.chat-timeline');
    timeline.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,bubbles:true}));
    const maximum=timeline.scrollHeight-timeline.clientHeight;
    timeline.scrollTop=Math.min(timeline.clientHeight*0.8,maximum/2);
    // Trigger the check explicitly without relying on when Chromium coalesces
    // the native scroll event with the viewport controller's frame callback.
    timeline.dispatchEvent(new Event('scroll'));
  })()`)
    await browser.until(() => evaluate('historyPaging.pending'), 'scroll requests an older page')
    await evaluate('settleHistoryLayout()')
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 25, 'held older page has not delivered any messages')
    assert.ok(await evaluate('(() => { const timeline=document.querySelector(".chat-timeline"); return timeline.scrollHeight-timeline.clientHeight-timeline.scrollTop>24 && timeline.scrollTop<=timeline.clientHeight })()'), 'reading position is near the top and actually away from the bottom')
    await evaluate(`(() => {
    const timeline=document.querySelector('.chat-timeline');
    const top=timeline.getBoundingClientRect().top;
    // Match the controller's first readable row. A different row can move when
    // same-second pages interleave new messages between it and that anchor.
    const inset=parseFloat(getComputedStyle(timeline.querySelector('.timeline-content')).marginTop)||0;
    const row=[...timeline.querySelectorAll('[data-message-id]')].find(row=>row.getBoundingClientRect().bottom>top+inset);
    window.pageAnchor={id:row.dataset.messageId,top:row.getBoundingClientRect().top};
  })()`)
    assert.equal(await evaluate('historyPaging.release()'), true, 'one real older page completes')
    await evaluate('settleHistoryLayout()')
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 50)
    const drift = await evaluate('Math.abs(document.querySelector("[data-message-id="+CSS.escape(pageAnchor.id)+"]").getBoundingClientRect().top-pageAnchor.top)')
    assert.ok(drift < 3, `reading anchor drift ${drift}`)
    console.log('History reading anchor drift:', drift)
    await evaluate('void (async()=>{ while(selfChatAccount.older$().hasOlder) { if(!await historyPaging.next()) throw new Error("page failed"); } window.historyAllLoaded=true })().catch(error=>{window.historyPageError=error.message})')
    await browser.until(() => evaluate('if(window.historyPageError)throw new Error(window.historyPageError);window.historyAllLoaded'), 'all timestamp pages', 120000)
    await evaluate('settleHistoryLayout()')
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 235)
    assert.equal(await evaluate('new Set(selfChatAccount.messages$().map(message=>message.id)).size'), 235)
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Preserved draft')
    await evaluate('document.querySelector(".chat-back").click()')
    await browser.until(() => evaluate('location.pathname === "/" && !!document.querySelector(".conversation [data-contact-id=user]")'), 'home from paged chat')
    await evaluate('document.querySelector(".conversation [data-contact-id=user]").click()')
    await browser.until(() => evaluate('location.pathname === "/chat/user" && !!document.querySelector(".route-page[data-active=true] .chat-composer textarea")'), 'retained chat')
    await evaluate('settleHistoryLayout()')
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 235)
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Preserved draft')
    // A private deletion and recovery reconcile retained pages without a kind-5 replay.
    await evaluate(`(async()=>{ const message=selfChatAccount.messages$()[0]; window.deletedPagedId=message.id; await window.napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e',message.id],['k','9']],content:''},{context:'dm:'+${JSON.stringify(pubkey)}}); await selfChatAccount.recover(); })()`)
    await browser.until(() => evaluate('!selfChatAccount.messages$().some(message=>message.id===deletedPagedId)'), 'deleted retained message')
    assert.equal(await evaluate('selfChatAccount.messages$().length'), 234)
    console.log('History: 235 timestamp ties, bounded opening, anchor, draft, retained pages and deletion passed')
  } finally {
    await evaluate('historyPaging.restore()')
  }
}
