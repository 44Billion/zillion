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

The default lifetime is four seconds. Pointer contact pauses expiry; release
extends it to eight seconds for the remainder of that queue's lifetime. New
notices and navigation restart the current duration. Keyboard focus inside the
content controls also pauses expiry until focus leaves the toast. Close is
exempt from pointer pausing. Unmounting the host clears the queue and timers.

The visual design is ported from ez-vault, with theme tokens owned by Zillion.
It uses the shared 718px column limit, a 12px inset, device safe areas, bounded
scrolling for long details, and reduced-motion support. Control labels follow
the launcher locale reactively. A polite status region announces the message;
the details button exposes its expanded state and controlled element.
