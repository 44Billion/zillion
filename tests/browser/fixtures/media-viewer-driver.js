import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'

// Visual test data only: production account APIs and storage are not replaced.
f('z-viewer-test-driver', ({ h }) => {
  const account = useAccount()
  window.viewerTest = {
    seed () {
      const fileId = 'b'.repeat(64)
      account.messages$([
        { id: 'first', kind: 9, content: 'https://viewer.example.com/first.jpg', tags: [], created_at: 1700000000 },
        { id: 'attachment', kind: 9, content: '', tags: [['q', fileId]], created_at: 1700000001 },
        { id: 'video', kind: 9, content: 'https://viewer.example.com/clip.mp4', tags: [], created_at: 1700000002 },
        { id: 'download', kind: 9, content: 'https://viewer.example.com/only.jpg#download=1', tags: [], created_at: 1700000003 }
      ])
      account.references$({ [fileId]: { id: fileId, kind: 1063, tags: [['url', 'https://viewer.example.com/second.jpg'], ['m', 'image/jpeg'], ['dim', '640x480']], content: 'A photograph from this conversation' } })
      account.profile$({ name: 'Viewer test', picture: 'https://viewer.example.com/portrait.jpg' })
      account.historyLoaded$(true)
    },
    remove () { account.messages$([]) }
  }
  return h`<span hidden></span>`
})
const host = document.createElement('div')
host.innerHTML = '<z-viewer-test-driver></z-viewer-test-driver>'
document.body.append(host)
