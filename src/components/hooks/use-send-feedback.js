import { useMemo, useTask } from '#f'
import { useAccount } from './use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import { error } from '#shared/toast.js'
import { createSendFeedback } from '#helpers/send-feedback.js'
import { sendFailure, sendFailureMessages } from '#helpers/send-failure.js'
import { getT } from '#i18n/index.js'
import locales from './send-failure-locales.json'

const t = getT(locales)
// Stable callbacks retain the toast's duplicate identity and live translation.
const messages = Object.fromEntries(Object.entries(sendFailureMessages).map(([reason, key]) => [reason, () => t(key)]))
const notify = cause => {
  const message = messages[sendFailure(cause)]
  if (message) error(message)
}

export function useSendFeedback (conversation) {
  const account = useAccount()
  const page = useRoutePage()
  const feedback = useMemo(() => createSendFeedback({ isActive: page.isActive$, peer: conversation.peer$, notify }))
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    track(() => conversation.peer$())
    feedback.clear()
    if (active) cleanup(account.observeSendErrors(feedback.failed))
    cleanup(feedback.clear)
  })
  useTask(({ track }) => feedback.reconcile(track(() => conversation.messages$())))
  return feedback
}
