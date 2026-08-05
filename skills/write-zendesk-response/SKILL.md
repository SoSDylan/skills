---
name: write-zendesk-response
description: Draft paste-ready client replies from established Zendesk support context. Use when the user asks to write or revise a response email to a customer.
disable-model-invocation: true
---

# Write a Zendesk Response

Write a warm, plainspoken reply for the client. Return a draft; a separate explicit request is required to send or update Zendesk.

## 1. Establish the message

Use the latest established facts from the conversation and supplied ticket context. Identify:

- the client's first name, when available
- the customer-visible problem
- the current status
- what the client should do next

Treat the operator's latest status update as authoritative. Ask one question when a missing status or next action would materially change the reply.

This step is complete when every claim planned for the response is supported by the available context.

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
2. A brief acknowledgement when appropriate.
3. The update in the first substantive sentence.
4. One clear next action.
5. An invitation to reply if the problem continues.

Use contractions, familiar words, short paragraphs, and a casual professional tone. Keep routine replies between 40 and 100 words. Include a subject or sign-off only when requested or established by the conversation.

Return only the paste-ready response text.

This step is complete when the reply is concise, human, factually supported, and ready to paste into Zendesk.
