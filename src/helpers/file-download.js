// A document-owned target avoids popups and keeps failed downloads from
// navigating the conversation. The response itself goes to the browser manager.
export const fileDownloadTarget = `zillion-file-${crypto.randomUUID()}`
