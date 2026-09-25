import { useTask, useMemo } from '#f'
import { useAccount } from './use-account.js'
import { useRoutePage } from '#shared/route-page.js'

export function canRecoverSignerFailure (error) {
  return !/DENIED|PERMISSION|REVOKED|INVALID|NOT_IN_PERSONA|READ_ONLY/i.test(`${error?.code || ''} ${error?.message || ''}`)
}
export function useSignerRecovery (retry, { when = 'visible' } = {}) {
  const account = useAccount()
  const page = useRoutePage()
  const runtime = useMemo(() => ({ seen: account.recovery$() }))
  useTask(({ track }) => {
    const version = track(() => account.recovery$())
    if (!track(() => page.isActive$()) || version === runtime.seen) return
    runtime.seen = version
    retry()
  }, { when })
}
