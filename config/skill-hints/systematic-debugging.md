SKILL HINT — this consult is bug-hunt shaped.

Use the `superpowers:systematic-debugging` skill to structure your
investigation. The skill walks through hypothesis → reproduction → root
cause; the protocol below lets you ask grounding questions without
deadlocking the consult.

AUTONOMY CONTRACT

This consult is automated. The skill you invoke may try to ask
clarifying questions one at a time. You may ask questions back to the
Maestro via your outbox, but follow these rules:

1. Ask ONE question at a time. Wait for the answer before asking the next.

2. To ask: append to your outbox.jsonl:
     {"event":"question","text":"<your question>","options":["A","B"]}
   Set your status to "blocked". Poll your inbox.md for a new write.
   When inbox.md changes, read the line beginning "ANSWER: " — that is
   the response. Resume your skill loop with it.

3. CHARACTER ENCODING (v0.3.0): "text" and "options" are PRINTABLE ASCII
   ONLY (0x20-0x7E). Percent-encode special chars:
     newline → %0A, tab → %09, " → %22, \ → %5C,
     literal , (in options) → %2C, literal % → %25.
   JSON escapes (\", \\, \n, \uXXXX) and non-ASCII bytes (UTF-8, emoji)
   are rejected.

4. Do not pre-classify questions as critical/non-critical. The Maestro
   makes that call. Just ask plainly.

5. Be concrete. "Is the error from the Postgres driver or our wrapper?"
   is good. "What's wrong?" is too open — investigate first.

6. Document each Q&A in your findings.md as:
     [Q&A] question: <q> // answer: <a> (resolved by Maestro)

7. If the skill says "ask the user X", you ask the Maestro X via this
   protocol. The Maestro will relay to the user only if the question is
   critical. Otherwise the Maestro answers from topic context.
