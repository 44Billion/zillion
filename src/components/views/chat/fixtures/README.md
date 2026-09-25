# Conversation fixtures

`messages.json` contains a fictional two-person exchange and separate self-chat
notes. `index.js` aligns the last message and clock labels with the selected
home preview. The contact and avatar come from the home fixtures. Quotes,
reactions, presence and the example.com card are sample content; no profile,
message, payment or preview data is fetched. Explicitly opening a sample link
uses an ordinary external link.

Daniel's promised photo uses `weekend-coffee.webp`: coffee and a brownie at an
outdoor table, matching the conversation's weekend coffee plans. Photo by
[Yulia Khlebnikova on Unsplash](https://unsplash.com/photos/b48p11jrWMw), used under
the [Unsplash License](https://unsplash.com/license). The bundled WebP is 540 × 720
pixels and 69,464 bytes, providing twice the resolution of its 270 × 360 CSS-pixel
chat bubble without a runtime download. It preserves the original composition.
Source rendition: `https://images.unsplash.com/photo-1578239864516-b9b3482dd60b?fit=max&w=960&h=720&fm=webp&q=50`.

English text is translated through `src/i18n/locales.json` in the render path.
This is preview localization, not automatic translation of real user messages.
When implementing messaging, replace this fixture provider with real data and
preserve message content as authored.

Open `/chat/maya` for a DM or `/chat/user` for self chat. Add `?entry=1` to replace
Back with the inert Zillion logo for a conversation used as the initial screen.
Unknown contacts have an unavailable state and perform no lookup. Home navigation,
Back/Forward, reload, scrolling, text editing and share/copy are functional.
Reply, Delete, Send, attention, attachments and camera controls have no action.
