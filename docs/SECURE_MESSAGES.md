# Multi-recipient secure messages

## Public API

Create `MultiRecipientSecureMessageCrypto` with a runtime-provided
`SecureRandomSource`. The runtime supplies cryptographically secure random
bytes only. The shared SDK owns ML-KEM-768, HKDF-SHA-256, SHA3-256 content-key
derivation and AES-256-GCM.

The byte-oriented methods are:

- `generateRecipientKeyPair(keyId)` creates an ML-KEM recipient key pair.
- `seal({ plaintext, contentType, recipients })` encrypts content once and
  protects the CEK independently for every recipient public key.
- `open({ envelope, recipient })` authenticates and returns the original bytes
  plus protected content type.
- `updateRecipients(...)` adds and removes recipient wraps without changing
  the content ciphertext.

Text callers encode/decode UTF-8 at their UI boundary. Audio callers pass the
recorded binary bytes directly. The cryptographic layer never transcribes,
converts or interprets either payload.

## Key model

One random 32-byte message seed deterministically derives one AES-256 CEK using
SHA3-256. Content is encrypted once with AES-256-GCM. For each recipient:

1. ML-KEM-768 independently produces a recipient-specific shared secret and
   KEM ciphertext.
2. HKDF-SHA-256 binds a wrapping key to the protected header and recipient
   `kid`.
3. AES-256-GCM protects the common CEK with that recipient wrapping key.

The common CEK is not the ML-KEM shared secret. This distinction permits every
authorized recipient to open the same content ciphertext while preserving an
independent post-quantum encapsulation for each recipient key.

## Recipient changes

`updateRecipients(...)` proves possession of one current recipient secret key,
unwraps the CEK in memory, adds independently wrapped CEKs for new public keys,
and removes selected old entries. It does not decrypt or re-encrypt message
content. Temporary buffers holding seeds, shared secrets, CEKs and wrapping
keys are cleared after use where the JavaScript runtime permits it.

This method is a cryptographic mechanism, not an authorization decision. A BFF
or product service must first enforce the current subject, device/channel,
Consent and recovery policy. It must reject an empty final recipient list.

## Storage and channels

Storage persists the opaque envelope from `sos-data-utils-ts`. It need not
retain a service recipient once the current user devices have received their
wraps. Web, telephone, WhatsApp or future channel DCRs use distinct `kid` and
ML-KEM keys, but the message remains one ciphertext.

Audio duration, file size, retention, notification email and voicemail access
are product-level policies. They do not change this envelope or core API.
