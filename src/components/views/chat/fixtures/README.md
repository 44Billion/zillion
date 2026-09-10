# Conversation fixtures

`messages.json` contains a fictional two-person exchange and separate self-chat
notes. `index.js` aligns the last message and clock labels with the selected
home preview. The contact and avatar come from the home fixtures. Quotes,
reactions, presence and the example.com card are sample content; no profile,
message, payment or preview data is fetched. Explicitly opening a sample link
uses an ordinary external link.

English text is translated through `src/i18n/locales.json` in the render path.
This is preview localization, not automatic translation of real user messages.
When implementing messaging, replace this fixture provider with real data and
preserve message content as authored.

Open `/chat/maya` for a DM or `/chat/user` for self chat. Add `?entry=1` to replace
Back with the inert Zillion logo for a conversation used as the initial screen.
Unknown contacts have an unavailable state and perform no lookup. Home navigation,
Back/Forward, reload, scrolling, text editing and share/copy are functional.
Reply, Delete, Send, attention, attachments and camera controls have no action.
