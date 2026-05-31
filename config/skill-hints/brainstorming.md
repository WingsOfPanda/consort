SKILL HINT — this consult is design-shaped.

Use the `superpowers:brainstorming` skill to structure your thinking. The
skill normally asks design questions one at a time; the protocol below
lets you do that without deadlocking the consult.

AUTONOMY CONTRACT

This consult is automated. The skill you invoke may try to ask design
questions one at a time. You may ask questions back to the Maestro
via your outbox, but follow these rules:

1. Ask ONE question at a time. Wait for the answer before asking the next.

2. To ask: append to your outbox.jsonl:
     {"event":"question","text":"<your question>","options":["A","B"]}
   Set your status to "blocked". Poll your inbox.md for a new write.
   When inbox.md changes, read the line beginning "ANSWER: " — that is
   the response. Resume your skill loop with it.

3. CHARACTER ENCODING (v0.3.0): "text" and "options" are PRINTABLE ASCII
   ONLY (0x20-0x7E). Special chars must be percent-encoded; JSON escapes
   are rejected; non-ASCII (UTF-8, emoji, non-Latin scripts) is rejected.
   Required encoding map:
     newline                →  %0A
     tab                    →  %09
     double-quote           →  %22
     backslash              →  %5C
     literal , (in options) →  %2C
     literal %              →  %25
   Example: instead of {"text":"He said \"hi\""} write
   {"text":"He said %22hi%22"}. For options like "Use Postgres, not MySQL",
   encode the comma: {"options":["Use Postgres%2C not MySQL"]}. To ask
   about literal "%22" (the encoding itself), write "%2522". The Maestro
   decodes %xx before answering.

4. Do not pre-classify questions as critical/non-critical. The Maestro
   makes that call. Just ask plainly.

5. Be concrete. "Should we use Postgres or DynamoDB?" is good.
   "What database?" is too open — answer it yourself with a default.

6. Document each Q&A in your findings.md as:
     [Q&A] question: <q> // answer: <a> (resolved by Maestro)
   This lets the consult reader see the design choices that shaped the
   findings.

7. If the skill says "ask the user X", you ask the Maestro X via this
   protocol. The Maestro will relay to the user only if the question is
   critical. Otherwise the Maestro answers from topic context.
