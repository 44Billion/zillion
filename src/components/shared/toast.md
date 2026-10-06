# Toast

`z-app` mounts one reactive `<z-toast />`. Import helpers from `#shared/toast.js`:

```js
import { getT } from '#i18n/index.js'
import { success, error, show, close } from '#shared/toast.js'

const t = getT(locales) // A catalog covering all supported locales.
const savedMessage = () => t('Saved')

success(savedMessage)
error(() => t('Could not save'), () => t('Try again later'))
show({ type: 'info', message: 'Literal text', longMessage: 'Optional details' })
close()
```

`success`, `error`, `warning`, and `info` take `(message, longMessage)`.
`show` accepts those four types and defaults unknown/missing types to `info`.
Text can be a string or a zero-argument function called during render. Use a
stable function that calls `t` for notices that should update while open;
passing `t('Saved')` stores a snapshot. Content is rendered as text, never HTML.
The example keys must be defined in the consumer's catalog.

The queue discards an earlier entry with the same type, message and details,
then shows the newest entry. Strings compare by value; callbacks compare by
identity. Previous/Next buttons browse the queue. Close dismisses the entire
queue. A new notice during closing starts a fresh queue and lifetime.

Persistent notices are opt-in and rendered alongside the transient queue:

```js
const notice = show({
  key: 'account-action',
  type: 'warning',
  message: () => t('Unlock your account'),
  persistent: true,
  dismissible: false
})
notice.update({ message: () => t('Import credentials') })
notice.close()
```

`persistent: true` returns an owner handle with `update` and `close`. There is
no expiry timer; `dismissible: false` omits the close button and rejects manual
dismissal. Each key owns one card whose DOM identity survives updates. Without
a key, notices are independent. A new publisher of the same key invalidates
older handles, and host teardown invalidates all handles. Updates cannot revive
a removed notice. Omitted update fields retain their values.

Global `close()`, transient expiry, queue navigation and new transient messages
never affect persistent notices. A handle closes only its own notice; it cannot
close the transient queue or another persistent card. All cards share the same
bounded column stack, with live text callbacks, themes and accessible details.
The existing helpers remain transient with their previous lifetimes.

The default lifetime is four seconds. Pointer contact pauses expiry; release
extends it to eight seconds for the remainder of that queue's lifetime. New
notices and navigation restart the current duration. Keyboard focus inside the
content controls also pauses expiry until focus leaves the toast. Close is
exempt from pointer pausing. Unmounting the host clears the queue and timers.

Bind bubbling focus events with `@focusin`/`@focusout`, which install listeners.
Their `onfocusin`/`onfocusout` counterparts are not native handler properties in
all browsers; uhtml can serialize those callbacks as executable HTML attributes.

The visual design is ported from ez-vault, with theme tokens owned by Zillion.
It uses the shared 718px column limit, a 12px inset, device safe areas, bounded
scrolling for long details, and reduced-motion support. Control labels follow
the launcher locale reactively. A polite status region announces the message;
the details button exposes its expanded state and controlled element.
