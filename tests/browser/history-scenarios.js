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
  await evaluate('document.querySelector(\'.conversation [data-contact-id=user]\').click()')
  await browser.until(() => evaluate('window.selfChatAccount?.historyState$() === "loaded" && document.querySelector(".chat-timeline")?.dataset.initialLoading === "false"'), '50-message opening', 60000)
  assert.equal(await evaluate('selfChatAccount.messages$().length'), 50)
  if (!process.argv.includes('--skip-measurement')) {
    await evaluate('void window.measureChatHistory().then(value=>window.historyMeasurements=value).catch(error=>window.historyMeasureError=error.message)')
    const measurements = await browser.until(() => evaluate('if(window.historyMeasureError)throw new Error(window.historyMeasureError);window.historyMeasurements'), 'real vault measurements', 240000)
    console.log('Real vault history measurements:', JSON.stringify(measurements))
    assert.equal(measurements.paged.decryptions, 50)
    assert.ok(measurements.paged.maxConcurrent <= 4 && measurements.paged.maxConcurrent > 1)
    assert.equal(measurements.paged.queries, 0)
    assert.equal(measurements.serial.decryptions, 200)
  }
  await evaluate('(() => { const input=document.querySelector(\'.chat-composer textarea\'); input.value=\'Preserved draft\'; input.dispatchEvent(new Event(\'input\',{bubbles:true})); })()')
  await evaluate(`(() => {
    const timeline=document.querySelector('.chat-timeline');
    timeline.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,bubbles:true})); timeline.scrollTop=timeline.clientHeight*0.8;
    const top=timeline.getBoundingClientRect().top;
    const row=[...timeline.querySelectorAll('[data-message-id]')].find(row=>row.getBoundingClientRect().bottom>top+80);
    window.pageAnchor={id:row.dataset.messageId,top:row.getBoundingClientRect().top};
  })()`)
  await browser.until(() => evaluate('selfChatAccount.messages$().length >= 100 && !selfChatAccount.older$().loading'), 'older page near viewport', 60000)
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const drift = await evaluate('Math.abs(document.querySelector("[data-message-id="+CSS.escape(pageAnchor.id)+"]").getBoundingClientRect().top-pageAnchor.top)')
  assert.ok(drift < 3, `reading anchor drift ${drift}`)
  await evaluate('void (async()=>{ while(selfChatAccount.older$().hasOlder) { if(!await selfChatAccount.loadOlder()) throw new Error("page failed"); } window.historyAllLoaded=true })()')
  await browser.until(() => evaluate('window.historyAllLoaded'), 'all timestamp pages', 120000)
  assert.equal(await evaluate('selfChatAccount.messages$().length'), 235)
  assert.equal(await evaluate('new Set(selfChatAccount.messages$().map(message=>message.id)).size'), 235)
  assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Preserved draft')
  await evaluate('document.querySelector(".chat-back").click()')
  await browser.until(() => evaluate('location.pathname === "/" && !!document.querySelector(".conversation [data-contact-id=user]")'), 'home from paged chat')
  await evaluate('document.querySelector(".conversation [data-contact-id=user]").click()')
  await browser.until(() => evaluate('location.pathname === "/chat/user"'), 'retained chat')
  assert.equal(await evaluate('selfChatAccount.messages$().length'), 235)
  assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Preserved draft')
  // A private deletion and recovery reconcile retained pages without a kind-5 replay.
  await evaluate(`(async()=>{ const message=selfChatAccount.messages$()[0]; window.deletedPagedId=message.id; await window.napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e',message.id],['k','9']],content:''},{context:'dm:'+${JSON.stringify(pubkey)}}); await selfChatAccount.recover(); })()`)
  await browser.until(() => evaluate('!selfChatAccount.messages$().some(message=>message.id===deletedPagedId)'), 'deleted retained message')
  assert.equal(await evaluate('selfChatAccount.messages$().length'), 234)
  console.log('History: 235 timestamp ties, bounded opening, anchor, draft, retained pages and deletion passed')
}
