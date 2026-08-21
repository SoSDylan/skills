---
name: write-zendesk-response
description: Draft paste-ready customer replies from established Zendesk support context. Use for direct reply requests and Zendesk triage response drafting.
---

# Write a Zendesk Response

Write a warm, plainspoken reply for the client. Return a draft; a separate explicit request is required to send or update Zendesk.

## 1. Establish the message

Use the latest established facts from the conversation and supplied ticket context. Identify:

- the customer's first name, when available
- their goal and why it matters to them
- their latest question or request
- the customer-visible problem
- the current status
- what the operator and customer should do next

Treat the operator's latest status update as authoritative. Use supported
inferences to acknowledge the customer's goal or impact, but keep uncertain
technical and financial claims out. Ask the operator one question only when a
missing status would make every honest draft misleading; otherwise draft the
current truth.

This step is complete when the response can address the customer's latest
request and every factual claim planned for it is supported by the available
context.

## 2. Match the status

Use precise status language:

- **Investigating:** say the team is looking into the issue and give only a supported follow-up expectation.
- **Fix prepared:** say the issue was found and a fix is prepared; say it is live only after the operator confirms deployment.
- **Fix live:** say the issue is fixed and the update is live, then ask the client to try again.
- **More information needed:** ask for the smallest specific detail needed and briefly explain why it helps.

Describe the customer-visible result rather than implementation details unless those details help the client act.

This step is complete when the wording communicates the exact current status without promises beyond the evidence.

## 3. Draft the reply

Use this default shape:

1. `Hi <first name>,`
2. A brief acknowledgement of the customer's goal or impact.
3. A direct answer to their latest request.
4. The current status in customer-visible terms.
5. One clear next action.
6. An invitation to reply when useful.

Use contractions, familiar words, short paragraphs, and a casual professional
tone. Keep routine replies between 40 and 120 words. Include a subject or sign-off
only when requested or established by the conversation.

When invoked directly, return only the paste-ready response text. When a parent
workflow delegates response drafting, return the draft to that workflow and let
it continue.

This step is complete when the reply is concise, human, factually supported, and
ready to paste into Zendesk.
