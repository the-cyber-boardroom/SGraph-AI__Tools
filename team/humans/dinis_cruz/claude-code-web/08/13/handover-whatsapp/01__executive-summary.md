# 1 — Executive Summary

## What we set out to do

Turn a Business WhatsApp number (we have one on a dedicated SIM, currently named
"Voice Debrief") into something we can operate from a browser tool: see
conversations, reply, transcribe inbound voice notes, and have AI draft replies
that a human approves before sending. It had to fit our existing platform — pure
browser-based tools, no heavy backend, agent-drivable — and be honest about
privacy.

## The single most important fact

**A WhatsApp number has exactly one home at a time: the phone app OR Meta's
Cloud API. Not both. Nothing syncs or migrates between them.**

Everything else follows from this:
- The number's current app-based chats cannot be "connected" to an API tool —
  the app has no API to read from.
- Registering the number on the Cloud API *disconnects* the phone app, and no
  chat history carries across.
- So if we want both an app experience *and* an automatable tool, we need **two
  numbers**.

## What we decided

1. **Official Meta Cloud API is the primary route** for a business number —
   stable, supported, has the template/messaging system, no ban risk. We
   explicitly rejected unofficial "link like an iPad" libraries for the business
   number because they carry a real account-ban risk.
2. **A two-number strategy** is the clean answer:
   - **API number** → Cloud API → the official, automatable, product-grade lane.
   - **App number** (a separate, expendable SIM) → can optionally be linked as a
     "companion device" (the iPad mechanism) to view its real chats in the same
     tool, accepting that route's ban risk *on that throwaway number only*.
3. **AI drafts, humans send.** No message goes out without an explicit action.
4. **Minimal servers.** The browser does almost everything; two tiny connector
   services exist only for the two things a browser physically cannot do
   (explained in doc 03).

## What we built (MVP, mock/demo-verified)

A browser "**WhatsApp Desk**" tool — conversations as tabs, WhatsApp's 24-hour
messaging-window rules handled automatically, inbound voice notes transcribed,
AI-drafted replies, and a **credential-free demo mode** so anyone can see the
full experience today. Plus the two small connector services and a reusable set
of chat UI components. All of it is tested against mocks and demo data; **no
live WhatsApp traffic has run yet.**

## Current state of the actual account

The "Voice Debrief" number is live on the **WhatsApp Business App** (the
phone app) — a working business identity, but *not* yet on the Cloud API. Moving
it to the API is a deliberate, one-way step (doc 05).

## What we need to decide / do next

1. **Decision:** migrate "Voice Debrief" to the Cloud API (loses the app on that
   number), *or* keep it on the app and put the API tool on a second number.
2. **Action with lead time:** start Meta business verification now — it can take
   days to weeks and blocks the live Cloud API path (nothing else waits on it).
3. Everything else (deploy the connector, paste credentials, live testing) is a
   single afternoon once verification clears.

## Bottom line for a partner

The thinking is done and the software works in demo. The remaining path to
production is mostly a Meta administrative process plus one strategic decision
about numbers — not further engineering. The design is deliberately modular, so
the same tool serves both the official API lane and (on an expendable number)
the full-chat-visibility companion lane.
