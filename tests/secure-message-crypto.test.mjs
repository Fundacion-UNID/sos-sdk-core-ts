// Flow contract: one message seed derives one content key, content is encrypted once, and independently wrapped recipient keys authorize text or binary-audio access.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MultiRecipientSecureMessageCrypto,
  deriveSecureMessageContentEncryptionKey,
} from '../dist/secure-message-crypto.js';

class DeterministicRandomSource {
  #counter = 1;

  async getRandomBytes(length) {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (this.#counter + index) & 0xff;
    }
    this.#counter = (this.#counter + length) & 0xff;
    return bytes;
  }
}

const createFixture = async () => {
  const secureMessages = new MultiRecipientSecureMessageCrypto(new DeterministicRandomSource());
  const web = await secureMessages.generateRecipientKeyPair('urn:example:key:web');
  const telephone = await secureMessages.generateRecipientKeyPair('urn:example:key:telephone');
  const service = await secureMessages.generateRecipientKeyPair('urn:example:key:service');
  const futureDevice = await secureMessages.generateRecipientKeyPair('urn:example:key:future-device');
  return { secureMessages, web, telephone, service, futureDevice };
};

test('preserves the historical deterministic message-seed to AES content-key contract', () => {
  const historicalMessageSeed = Uint8Array.from(
    Buffer.from('MDEyMzQ1Njc4OT0_PT89PzAxMjM0NTY3ODk9Pz0_PT8', 'base64url'),
  );

  const contentEncryptionKey = deriveSecureMessageContentEncryptionKey(historicalMessageSeed);

  assert.equal(Buffer.from(contentEncryptionKey).toString('base64url'), '0fbuLrtPZbV0WV6_TqPLsOOWFZx6eshzIdGjFtkmbAE');
});

test('encrypts text once and lets every current ML-KEM recipient decrypt the same ciphertext', async () => {
  const { secureMessages, web, telephone } = await createFixture();
  const plaintext = new TextEncoder().encode('Private inbox message');

  const envelope = await secureMessages.seal({
    plaintext,
    contentType: 'text/plain;charset=utf-8',
    recipients: [web, telephone],
  });

  assert.equal(envelope.recipients.length, 2);
  assert.deepEqual((await secureMessages.open({ envelope, recipient: web })).plaintext, plaintext);
  assert.deepEqual((await secureMessages.open({ envelope, recipient: telephone })).plaintext, plaintext);
});

test('uses the same envelope contract for binary audio without converting it to text', async () => {
  const { secureMessages, telephone } = await createFixture();
  const audioBytes = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0xff, 0x80]);

  const envelope = await secureMessages.seal({
    plaintext: audioBytes,
    contentType: 'audio/ogg',
    recipients: [telephone],
  });
  const opened = await secureMessages.open({ envelope, recipient: telephone });

  assert.equal(opened.contentType, 'audio/ogg');
  assert.deepEqual(opened.plaintext, audioBytes);
});

test('re-envelopes the CEK to current devices and removes the temporary service without re-encrypting content', async () => {
  const { secureMessages, web, telephone, service, futureDevice } = await createFixture();
  const initialEnvelope = await secureMessages.seal({
    plaintext: Uint8Array.from([1, 2, 3, 4]),
    contentType: 'application/octet-stream',
    recipients: [service],
  });

  const currentDeviceEnvelope = await secureMessages.updateRecipients({
    envelope: initialEnvelope,
    authorizingRecipient: service,
    addRecipients: [web, telephone],
    removeRecipientKeyIds: [service.keyId],
  });

  assert.equal(currentDeviceEnvelope.ciphertext, initialEnvelope.ciphertext);
  assert.equal(currentDeviceEnvelope.iv, initialEnvelope.iv);
  assert.equal(currentDeviceEnvelope.tag, initialEnvelope.tag);
  assert.deepEqual(
    currentDeviceEnvelope.recipients.map(({ header }) => header.kid).sort(),
    [telephone.keyId, web.keyId].sort(),
  );
  await assert.rejects(
    () => secureMessages.open({ envelope: currentDeviceEnvelope, recipient: service }),
    /secure_message_recipient_not_found/,
  );

  const futureEnvelope = await secureMessages.updateRecipients({
    envelope: currentDeviceEnvelope,
    authorizingRecipient: web,
    addRecipients: [futureDevice],
  });
  assert.deepEqual(
    (await secureMessages.open({ envelope: futureEnvelope, recipient: futureDevice })).plaintext,
    Uint8Array.from([1, 2, 3, 4]),
  );
});

test('fails closed for unknown recipients, duplicate keys and ciphertext tampering', async () => {
  const { secureMessages, web, telephone } = await createFixture();
  const envelope = await secureMessages.seal({
    plaintext: Uint8Array.from([1, 2, 3]),
    contentType: 'audio/ogg',
    recipients: [web],
  });

  await assert.rejects(
    () => secureMessages.open({ envelope, recipient: telephone }),
    /secure_message_recipient_not_found/,
  );
  await assert.rejects(
    () => secureMessages.seal({
      plaintext: Uint8Array.from([1]),
      contentType: 'text/plain',
      recipients: [web, web],
    }),
    /secure_message_recipient_duplicate/,
  );
  await assert.rejects(
    () => secureMessages.updateRecipients({
      envelope,
      authorizingRecipient: web,
      removeRecipientKeyIds: [web.keyId],
    }),
    /secure_message_recipients_required/,
  );
  await assert.rejects(
    () => secureMessages.updateRecipients({
      envelope,
      authorizingRecipient: web,
      removeRecipientKeyIds: ['urn:example:key:not-present'],
    }),
    /secure_message_recipient_remove_not_found/,
  );
  await assert.rejects(
    () => secureMessages.open({
      envelope: {
        ...envelope,
        ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`,
      },
      recipient: web,
    }),
  );
});

test('rejects invalid runtime random-source output before using cryptography', async () => {
  const invalidRandomSource = {
    async getRandomBytes(length) {
      return new Uint8Array(Math.max(0, length - 1));
    },
  };
  const secureMessages = new MultiRecipientSecureMessageCrypto(invalidRandomSource);

  await assert.rejects(
    () => secureMessages.generateRecipientKeyPair('urn:example:key:invalid-random'),
    /secure_random_source_invalid/,
  );
});
