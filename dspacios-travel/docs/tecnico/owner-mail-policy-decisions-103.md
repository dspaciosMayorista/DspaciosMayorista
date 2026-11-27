# Mail-policy decisions still open — block #103 (for the owner)

Date: 2026-11-22. Companion to [owner-walkthrough-103.md](owner-walkthrough-103.md). **None of these has been decided or acted on.** Until you decide, the safe defaults apply: outgoing supplier mail is disabled or captured locally, the Hostinger inbound entry is switched **off**, nothing is sent or read live, and no provider, DNS, mailbox or billing setting has been touched. Activating anything is an owner action (it needs your credentials and environment settings); it is **not authorized** by this paper.

How to read each item: *What it is* · *Options* · *Recommendation* · *If you do nothing*.

## A. Decisions that shape what is sent and who sees it

**M1 — Sender and reply address.**
What it is: the «from» address of supplier requests and payment notices, and the address suppliers answer (the system adds a private token to it so a reply finds its request).
Options: (a) a dedicated reply address on the domain you already use for the Hostinger mailbox; (b) a reply sub-domain handled by Resend.
Recommendation: (a) if M2 chooses the Hostinger mailbox; otherwise (b). Either way use a separate sub-address such as `respuestas@…`, never a person's inbox.
If you do nothing: mail stays disabled/captured; the configured sender is a placeholder.

**M2 — How replies come back in.**
What it is: today a reply is only visible if someone reads the mailbox. The block adds, **switched off**, a reader for the Hostinger mailbox: Hostinger notifies the app, the app reads the mailbox through Hostinger's API and records replies on the right request. It is built and tested only against a **simulated** Hostinger.
Options: (a) Hostinger mailbox + notification + a daily safety drain (built); (b) Resend inbound (needs an MX record and a plan check; its notification carries no message body, so a second step is needed); (c) no inbound reading — staff mark answers by hand with the existing manual controls.
Recommendation: (a) after the three checks in M3; (c) is a perfectly safe interim.
If you do nothing: (c).

**M3 — Checks that must succeed before relying on (a) (need your credentials / a test mailbox).**
1. Does the Hostinger mailbox deliver mail addressed to `respuestas+TOKEN@…` to the same mailbox (plus-addressing)? Not documented by Hostinger; **unverified**. If not, a catch-all address or a different token placement is needed (a design change).
2. What exactly does Hostinger's `message.received` notification contain? Not documented; the app ignores its content and only uses it as a trigger — verify once with a test message.
3. Does the Hostinger plan allow the API and the daily volume (documented: 1,000 messages/day per mailbox on the entry plan)?
Owner action: provide a test mailbox and approve a one-off live test; no credential is ever pasted in a chat.

**M4 — Who is told about a reply or a payment notice.**
What it is: on-screen notices currently go to **the person who sent the request plus all active «operaciones» users of that agency**; an optional internal e-mail goes to the list you configure (`interno@…`). The earlier acceptance matrix said «the contract's advisor + operaciones».
Options: keep as built; or advisor of the contract + operaciones; plus the internal e-mail list (who?).
Recommendation: keep as built unless the contract's advisor differs from the person who sent the request often.
If you do nothing: as built; no internal e-mail unless you configure a list.

**M5 — When a payment notice may be sent.**
What it is: today only by a person pressing «Enviar aviso» after a preview (never automatic).
Options: keep manual; or automatic prompt after a payment is registered (never auto-send).
Recommendation: keep manual until the supplier relationship and the wording are settled.
If you do nothing: manual only.

**M6 — Approve the content of a supplier request.**
What it is: a table + plain text with holder, stays, traveller names and ages at check-in; **no prices, costs, commissions or customer vouchers**; no attachments.
Options: approve; add/remove fields (e.g. nationality, phone, notes); allow attachments.
Recommendation: approve as is for the pilot; review the wording with one real supplier.
If you do nothing: the field list stays as shown in the walkthrough (W6).

**M7 — Promotion codes.**
What it is: a code belongs to a promotion's validity at one hotel; the sender must choose the code or declare «this booking does not use the promotion»; the hotel is matched by name and the sender confirms it (the contract does not record the catalogue hotel or which promotion was used).
Options: confirm as built; or record the hotel and the promotion on the contract (a data change, later).
Recommendation: confirm as built for now.
If you do nothing: as built.

**M8 — «A reply never confirms or rejects.»**
What it is: a supplier's answer only moves the card to «Respondió». A person decides confirmed/rejected afterwards. Text such as «confirmamos» is never interpreted.
Options: keep (recommended); or allow a future opt-in rule for obvious cases.
If you do nothing: kept.

## B. Decisions about the inbound reader's behaviour (only matter if M2 = a)

**M9 — Latency of the safety drain.** The hosting plan allows the scheduled drain once a day (the entry is set to 11:30 each day). A reply is recorded as soon as Hostinger notifies the app; if a notification is lost, the reply can wait **up to a day**. Options: accept; or a more frequent trigger (another plan or an outside scheduler — a cost/hosting decision). Recommendation: accept for the pilot. Hosted cost and function-time limits are **unmeasured**.

**M10 — Age rule for the very first reading.** The first time the mailbox is read, replies older than **72 hours by the sender's own date** are skipped, so years of old mail are not resurrected. A delayed or wrong-clock reply could be skipped. Later readings have no age limit. Options: keep 72 h; a longer window; no limit (reads the whole mailbox once). Recommendation: keep 72 h and start the entry on a clean mailbox dedicated to replies. If you do nothing: 72 h.

**M11 — Replies that cannot be read.** A reply whose download keeps failing is parked and retried on every later pass and never expires. Options: leave it; alert after N days; a manual «discard» control. Recommendation: alert after a few days (not built). If you do nothing: it stays parked silently.

**M12 — Privacy and retention of reply text.** An excerpt of each reply is stored in the request's event history and is included in the internal notice e-mail. Options: keep for the life of the contract; shorten; store no text. Recommendation: keep for the contract's life; exclude attachments (already not read). If you do nothing: kept.

## C. Provider and plan decisions

**M13 — Resend plan and billing** for expected volume (outgoing requests/notices and, if chosen, inbound); and **whether to use Hostinger's API at all** (M2). Outgoing mail stays on Resend because only Resend can guarantee a retried send never produces a second message (idempotency key) and can carry the reply token; Hostinger's send cannot. Owner action: confirm plan/limits.

**M14 — Activation and secrets.** Switching the inbound entry on requires environment settings (a webhook secret, a mailbox id, the API token) set by you in the hosting dashboard, then a recorded live test. Rotation and storage of those secrets is your call. Not authorized now.

## D. Related, not mail (listed so they are not lost)

- Schedule the background tariff-update resume (daily) — today it resumes when someone opens the hotel page or presses «Actualizar ahora».
- Skip regenerating packages whose travel window cannot touch the changed dates (reduces work; changes what is regenerated).
- Apply migrations 327–330 to the real database only after the owner's preflight/postcheck sequence (documented in the delivery report); none is applied today.

## Suggested order

1. Walk through [owner-walkthrough-103.md](owner-walkthrough-103.md).
2. Decide M1, M4, M5, M6, M7, M8 (policy; no technical risk).
3. Decide M2; if (a), authorise the one-off checks in M3, then M9–M12, M13, M14.
