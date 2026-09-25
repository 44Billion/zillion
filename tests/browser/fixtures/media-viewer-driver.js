import { f } from '#f'
import { getEventHash } from 'libp2r2p/event'
import { useAccount } from '#hooks/use-account.js'

// Visual test data only: production account APIs and storage are not replaced.
f('z-viewer-test-driver', ({ h }) => {
  const account = useAccount()
  window.viewerTest = {
    recover: account.recover,
    async seed () {
      while (!account.ready$() || !account.pubkey$() || account.historyState$() !== 'loaded') await new Promise(resolve => setTimeout(resolve, 20))
      const owner = account.pubkey$()
      const template = { kind: 1063, created_at: 1700000001, tags: [['url', 'https://viewer.example.com/second.jpg'], ['m', 'image/jpeg'], ['dim', '640x480']], content: 'A photograph from this conversation' }
      const fileId = getEventHash({ ...template, pubkey: owner })
      await window.napp.eventStore.addPersonalCopy(template, { context: `dm:${owner}` })
      window.viewerTest.fileId = `file:${fileId}`
      account.messages$([
        { id: 'first', kind: 9, content: 'https://viewer.example.com/first.jpg', tags: [], created_at: 1700000000 },
        { id: 'attachment', kind: 9, content: '', tags: [['q', fileId]], created_at: 1700000001 },
        { id: 'video', kind: 9, content: 'https://viewer.example.com/clip.mp4', tags: [], created_at: 1700000002 },
        { id: 'download', kind: 9, content: 'https://viewer.example.com/only.jpg#download=1', tags: [], created_at: 1700000003 }
      ])
      account.references$({ [fileId]: { ...template, pubkey: owner, id: fileId } })
      account.profile$({ name: 'Viewer test', picture: 'https://viewer.example.com/portrait.jpg' })
      account.historyLoaded$(true)
    },
    seedUrls (urls) {
      account.messages$(urls.map((url, n) => ({ id: `controlled-${n}`, kind: 9, content: url, tags: [], created_at: 2000000000 + n })))
    },
    stageFile () {
      const template = { kind: 1063, created_at: 2000000010, tags: [['url', 'https://viewer.example.com/pending.jpg'], ['m', 'image/jpeg']], content: '' }
      const file = { ...template, pubkey: account.pubkey$(), id: getEventHash({ ...template, pubkey: account.pubkey$() }) }
      account.references$({ ...account.references$(), [file.id]: file })
      account.messages$([{ id: 'controlled-pending', kind: 9, content: '', tags: [['q', file.id]], created_at: template.created_at, status: 'pending' }])
      window.viewerTest.finishFile = async () => {
        const result = await window.napp.eventStore.addPersonalCopy(template, { context: `dm:${account.pubkey$()}` })
        if (!result.result.ok) throw new Error('Fixture write failed')
        account.messages$(messages => messages.map(message => ({ ...message, status: 'saved' })))
      }
      return `file:${file.id}`
    },
    async remove () {
      await window.napp.eventStore.addPersonalCopy({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', window.viewerTest.fileId.slice(5)], ['k', '1063']], content: '' }, { context: `dm:${account.pubkey$()}` })
    },
    async addFile (n, mime) {
      const template = { kind: 1063, created_at: 1700004000 + n, tags: [['url', mime.startsWith('video/') ? 'https://viewer.example.com/clip.mp4' : `https://viewer.example.com/live-${n}.jpg`], ['m', mime], ['salt', String(n)]], content: '' }
      const result = await window.napp.eventStore.addPersonalCopy(template, { context: `dm:${account.pubkey$()}` })
      if (!result.result.ok) throw new Error('Fixture write failed')
      return `file:${getEventHash({ ...template, pubkey: account.pubkey$() })}`
    },
    async seedMany (size = 60) {
      const ids = []
      for (let n = 0; n < size; n++) {
        const template = { kind: 1063, created_at: 1700001000 + n, tags: [['url', `https://viewer.example.com/bounded-${n}.jpg`], ['m', 'image/jpeg'], ['salt', String(n)]], content: '' }
        const result = await window.napp.eventStore.addPersonalCopy(template, { context: `dm:${account.pubkey$()}` })
        if (!result.result.ok) throw new Error('Fixture write failed')
        ids.push(`file:${getEventHash({ ...template, pubkey: account.pubkey$() })}`)
      }
      account.messages$([])
      window.viewerTest.many = ids
      return ids
    }
  }
  return h`<span hidden></span>`
})
const host = document.createElement('div')
host.innerHTML = '<z-viewer-test-driver></z-viewer-test-driver>'
document.body.append(host)
