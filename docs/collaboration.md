# Manual collaboration

DrawDSL pairs browsers directly without a signaling server or application backend.

1. The host clicks **Collaborate** and copies the invitation link.
2. One guest opens that link and copies the generated answer link back to the host.
3. The host pastes the answer into **Guest's answer link** and clicks **Connect guest**.
4. Close the dialog to edit. Changes merge through Yjs; rendering and exports stay local.

Use **New invitation** for each additional guest. It expires the previous unanswered
invitation. Keep the host tab open: it relays changes between guests. Pairing links
contain connection details in the URL fragment, which is not sent to the web host.
WebRTC encrypts the document traffic with DTLS. Treat pairing links as invitations
to edit and exchange them with the intended participant.

IndexedDB keeps a local copy of the document. Refreshing or closing a tab ends its
peer connections; exchange fresh pairing links to reconnect. A guest can reopen
its old invitation to recover its local copy, but needs to return a new answer.
The host's session URL restores its IndexedDB copy and generates a new invitation
after a refresh. The host must re-pair each guest.

No WebSocket signaling service is used. A public STUN service discovers network
addresses; it does not store documents or relay edits. Restrictive NATs/firewalls
may still prevent direct connections. There is no TURN relay fallback. Small rooms
(2–5 participants) are recommended; received Yjs updates are limited to 8 MiB.

## Verification

`npm run test:web` exercises the full UI pairing flow and Yjs synchronization with
a deterministic data-channel transport so CI does not depend on UDP networking.
To test native WebRTC on a network that permits direct connections:

```sh
npm run web:build
DRAWDSL_LIVE_WEBRTC=1 npx playwright test web-tests/collaboration.spec.ts
```
