import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import {
  SecureMessageContentEncryptionAlgorithm,
  SecureMessageEnvelopeProfile,
  SecureMessageKeyManagementAlgorithm,
  assertSecureMessageEnvelope,
  type SecureMessageEnvelope,
  type SecureMessageRecipient,
} from 'sos-data-utils-ts/secure-message-envelope';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder(undefined, { fatal: true });
const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const ML_KEM_KEYGEN_SEED_BYTES = 64;
const ML_KEM_ENCAPSULATION_SEED_BYTES = 32;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const WRAP_VERSION = 'mlkem-cek-wrap-v1';

export interface SecureRandomSource {
  getRandomBytes(length: number): Promise<Uint8Array>;
}

export interface SecureMessageRecipientPublicKey {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
}

export interface SecureMessageRecipientKeyPair extends SecureMessageRecipientPublicKey {
  readonly secretKey: Uint8Array;
}

export interface OpenedSecureMessage {
  readonly contentType: string;
  readonly plaintext: Uint8Array;
}

interface ProtectedHeader {
  readonly typ: 'application/jose+json';
  readonly cty: string;
  readonly enc: typeof SecureMessageContentEncryptionAlgorithm.A256GCM;
  readonly profile: typeof SecureMessageEnvelopeProfile.MultirecipientMlKemV1;
}

interface WrappedContentEncryptionKey {
  readonly v: typeof WRAP_VERSION;
  readonly kem: 'ML-KEM-768';
  readonly kdf: 'HKDF-SHA-256';
  readonly wrap: 'A256GCM';
  readonly kemCiphertext: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

const assertRandomBytes = (bytes: Uint8Array, expectedLength: number): Uint8Array => {
  if (!(bytes instanceof Uint8Array) || bytes.length !== expectedLength) {
    throw new Error('secure_random_source_invalid');
  }
  return bytes;
};

const assertKeyId = (keyId: string): string => {
  const normalized = String(keyId).trim();
  if (!normalized) throw new Error('secure_message_recipient_key_id_required');
  return normalized;
};

const encodeBase64Url = (bytes: Uint8Array): string => {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL_ALPHABET[(combined >>> 18) & 63];
    output += BASE64URL_ALPHABET[(combined >>> 12) & 63];
    if (second !== undefined) output += BASE64URL_ALPHABET[(combined >>> 6) & 63];
    if (third !== undefined) output += BASE64URL_ALPHABET[combined & 63];
  }
  return output;
};

const decodeBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('secure_message_base64url_invalid');
  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let outputOffset = 0;
  for (const character of value) {
    const alphabetIndex = BASE64URL_ALPHABET.indexOf(character);
    if (alphabetIndex < 0) throw new Error('secure_message_base64url_invalid');
    accumulator = (accumulator << 6) | alphabetIndex;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputOffset] = (accumulator >>> bits) & 0xff;
      outputOffset += 1;
    }
  }
  return output;
};

const encodeJson = (value: unknown): string => encodeBase64Url(textEncoder.encode(JSON.stringify(value)));

const decodeJson = <T>(value: string): T => {
  try {
    return JSON.parse(textDecoder.decode(decodeBase64Url(value))) as T;
  } catch {
    throw new Error('secure_message_json_invalid');
  }
};

const splitCiphertextAndTag = (sealed: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } => {
  if (sealed.length < AES_GCM_TAG_BYTES) throw new Error('secure_message_ciphertext_invalid');
  return {
    ciphertext: sealed.slice(0, -AES_GCM_TAG_BYTES),
    tag: sealed.slice(-AES_GCM_TAG_BYTES),
  };
};

const joinCiphertextAndTag = (ciphertext: Uint8Array, tag: Uint8Array): Uint8Array => {
  if (tag.length !== AES_GCM_TAG_BYTES) throw new Error('secure_message_tag_invalid');
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  return sealed;
};

const protectedHeader = (contentType: string): ProtectedHeader => {
  const normalizedContentType = String(contentType).trim();
  if (!normalizedContentType || normalizedContentType.length > 255 || /[\u0000-\u001f\u007f]/u.test(normalizedContentType)) {
    throw new Error('secure_message_content_type_invalid');
  }
  return {
    typ: 'application/jose+json',
    cty: normalizedContentType,
    enc: SecureMessageContentEncryptionAlgorithm.A256GCM,
    profile: SecureMessageEnvelopeProfile.MultirecipientMlKemV1,
  };
};

const parseProtectedHeader = (encoded: string): ProtectedHeader => {
  const header = decodeJson<Partial<ProtectedHeader>>(encoded);
  if (header.typ !== 'application/jose+json'
    || typeof header.cty !== 'string'
    || header.enc !== SecureMessageContentEncryptionAlgorithm.A256GCM
    || header.profile !== SecureMessageEnvelopeProfile.MultirecipientMlKemV1) {
    throw new Error('secure_message_protected_header_invalid');
  }
  return protectedHeader(header.cty);
};

const deriveRecipientWrappingKey = (
  sharedSecret: Uint8Array,
  encodedProtectedHeader: string,
  recipientKeyId: string,
): Uint8Array => hkdf(
  sha256,
  sharedSecret,
  textEncoder.encode('multi-recipient-ml-kem-v1'),
  textEncoder.encode(`${encodedProtectedHeader}.${recipientKeyId}.cek`),
  AES_KEY_BYTES,
);

/**
 * Preserve the historical secure-message contract: one random 32-byte message
 * seed deterministically derives the AES-256 content-encryption key. The CEK is
 * then wrapped independently for every current ML-KEM recipient.
 */
export const deriveSecureMessageContentEncryptionKey = (messageSeed: Uint8Array): Uint8Array => {
  if (!(messageSeed instanceof Uint8Array) || messageSeed.length !== AES_KEY_BYTES) {
    throw new Error('secure_message_seed_invalid');
  }
  return sha3_256(messageSeed);
};

/** Runtime-neutral ML-KEM multi-recipient encryption for text or binary audio messages. */
export class MultiRecipientSecureMessageCrypto {
  public constructor(private readonly randomSource: SecureRandomSource) {}

  public async generateRecipientKeyPair(keyId: string): Promise<SecureMessageRecipientKeyPair> {
    const seed = assertRandomBytes(
      await this.randomSource.getRandomBytes(ML_KEM_KEYGEN_SEED_BYTES),
      ML_KEM_KEYGEN_SEED_BYTES,
    );
    try {
      const { publicKey, secretKey } = ml_kem768.keygen(seed);
      return { keyId: assertKeyId(keyId), publicKey, secretKey };
    } finally {
      seed.fill(0);
    }
  }

  public async seal(input: Readonly<{
    plaintext: Uint8Array;
    contentType: string;
    recipients: readonly SecureMessageRecipientPublicKey[];
  }>): Promise<SecureMessageEnvelope> {
    if (!(input.plaintext instanceof Uint8Array) || input.plaintext.length === 0) {
      throw new Error('secure_message_plaintext_required');
    }
    this.assertUniqueRecipientKeys(input.recipients);

    const messageSeed = assertRandomBytes(
      await this.randomSource.getRandomBytes(AES_KEY_BYTES),
      AES_KEY_BYTES,
    );
    const cek = deriveSecureMessageContentEncryptionKey(messageSeed);
    const iv = assertRandomBytes(await this.randomSource.getRandomBytes(AES_GCM_NONCE_BYTES), AES_GCM_NONCE_BYTES);
    const encodedProtectedHeader = encodeJson(protectedHeader(input.contentType));
    try {
      const sealed = gcm(cek, iv, textEncoder.encode(encodedProtectedHeader)).encrypt(input.plaintext);
      const { ciphertext, tag } = splitCiphertextAndTag(sealed);
      const recipients: SecureMessageRecipient[] = [];
      for (const recipient of input.recipients) {
        recipients.push(await this.wrapContentEncryptionKey(cek, encodedProtectedHeader, recipient));
      }
      const envelope: SecureMessageEnvelope = {
        profile: SecureMessageEnvelopeProfile.MultirecipientMlKemV1,
        protected: encodedProtectedHeader,
        recipients,
        iv: encodeBase64Url(iv),
        ciphertext: encodeBase64Url(ciphertext),
        tag: encodeBase64Url(tag),
      };
      assertSecureMessageEnvelope(envelope);
      return envelope;
    } finally {
      messageSeed.fill(0);
      cek.fill(0);
      iv.fill(0);
    }
  }

  public async open(input: Readonly<{
    envelope: SecureMessageEnvelope;
    recipient: SecureMessageRecipientKeyPair;
  }>): Promise<OpenedSecureMessage> {
    assertSecureMessageEnvelope(input.envelope);
    const header = parseProtectedHeader(input.envelope.protected);
    const cek = await this.unwrapContentEncryptionKey(input.envelope, input.recipient);
    try {
      const plaintext = gcm(
        cek,
        decodeBase64Url(input.envelope.iv),
        textEncoder.encode(input.envelope.protected),
      ).decrypt(joinCiphertextAndTag(
        decodeBase64Url(input.envelope.ciphertext),
        decodeBase64Url(input.envelope.tag),
      ));
      return { contentType: header.cty, plaintext };
    } finally {
      cek.fill(0);
    }
  }

  /**
   * Rewrap the existing CEK without opening or re-encrypting message content.
   * Business authorization for adding or removing a DCR remains with the caller.
   */
  public async updateRecipients(input: Readonly<{
    envelope: SecureMessageEnvelope;
    authorizingRecipient: SecureMessageRecipientKeyPair;
    addRecipients?: readonly SecureMessageRecipientPublicKey[];
    removeRecipientKeyIds?: readonly string[];
  }>): Promise<SecureMessageEnvelope> {
    assertSecureMessageEnvelope(input.envelope);
    parseProtectedHeader(input.envelope.protected);
    const addRecipients = input.addRecipients ?? [];
    this.assertUniqueRecipientKeys(addRecipients, false);
    const removedKeyIds = new Set((input.removeRecipientKeyIds ?? []).map(assertKeyId));
    const existingKeyIds = new Set(input.envelope.recipients.map(({ header }) => header.kid));
    for (const removedKeyId of removedKeyIds) {
      if (!existingKeyIds.has(removedKeyId)) {
        throw new Error('secure_message_recipient_remove_not_found');
      }
    }
    const retainedRecipients = input.envelope.recipients.filter(({ header }) => !removedKeyIds.has(header.kid));
    const retainedKeyIds = new Set(retainedRecipients.map(({ header }) => header.kid));
    for (const recipient of addRecipients) {
      const keyId = assertKeyId(recipient.keyId);
      if (retainedKeyIds.has(keyId)) throw new Error('secure_message_recipient_duplicate');
      retainedKeyIds.add(keyId);
    }
    if (retainedRecipients.length + addRecipients.length === 0) {
      throw new Error('secure_message_recipients_required');
    }

    const cek = await this.unwrapContentEncryptionKey(input.envelope, input.authorizingRecipient);
    try {
      const addedRecipients: SecureMessageRecipient[] = [];
      for (const recipient of addRecipients) {
        addedRecipients.push(await this.wrapContentEncryptionKey(cek, input.envelope.protected, recipient));
      }
      const updatedEnvelope: SecureMessageEnvelope = {
        ...input.envelope,
        recipients: [...retainedRecipients, ...addedRecipients],
      };
      assertSecureMessageEnvelope(updatedEnvelope);
      return updatedEnvelope;
    } finally {
      cek.fill(0);
    }
  }

  private assertUniqueRecipientKeys(
    recipients: readonly SecureMessageRecipientPublicKey[],
    requireAtLeastOne = true,
  ): void {
    if (!Array.isArray(recipients) || (requireAtLeastOne && recipients.length === 0)) {
      throw new Error('secure_message_recipients_required');
    }
    const keyIds = new Set<string>();
    for (const recipient of recipients) {
      const keyId = assertKeyId(recipient.keyId);
      if (!(recipient.publicKey instanceof Uint8Array)) throw new Error('secure_message_recipient_public_key_invalid');
      if (keyIds.has(keyId)) throw new Error('secure_message_recipient_duplicate');
      keyIds.add(keyId);
    }
  }

  private async wrapContentEncryptionKey(
    cek: Uint8Array,
    encodedProtectedHeader: string,
    recipient: SecureMessageRecipientPublicKey,
  ): Promise<SecureMessageRecipient> {
    const recipientKeyId = assertKeyId(recipient.keyId);
    const encapsulationSeed = assertRandomBytes(
      await this.randomSource.getRandomBytes(ML_KEM_ENCAPSULATION_SEED_BYTES),
      ML_KEM_ENCAPSULATION_SEED_BYTES,
    );
    let sharedSecret: Uint8Array | undefined;
    let wrappingKey: Uint8Array | undefined;
    const wrappingIv = assertRandomBytes(
      await this.randomSource.getRandomBytes(AES_GCM_NONCE_BYTES),
      AES_GCM_NONCE_BYTES,
    );
    try {
      const encapsulated = ml_kem768.encapsulate(recipient.publicKey, encapsulationSeed);
      sharedSecret = encapsulated.sharedSecret;
      wrappingKey = deriveRecipientWrappingKey(sharedSecret, encodedProtectedHeader, recipientKeyId);
      const wrapAad = textEncoder.encode(`${encodedProtectedHeader}.${recipientKeyId}.cek`);
      const sealedCek = gcm(wrappingKey, wrappingIv, wrapAad).encrypt(cek);
      const { ciphertext, tag } = splitCiphertextAndTag(sealedCek);
      const wrappedCek: WrappedContentEncryptionKey = {
        v: WRAP_VERSION,
        kem: 'ML-KEM-768',
        kdf: 'HKDF-SHA-256',
        wrap: 'A256GCM',
        kemCiphertext: encodeBase64Url(encapsulated.cipherText),
        iv: encodeBase64Url(wrappingIv),
        ciphertext: encodeBase64Url(ciphertext),
        tag: encodeBase64Url(tag),
      };
      return {
        header: {
          alg: SecureMessageKeyManagementAlgorithm.MlKem768HkdfSha256A256GcmKw,
          kid: recipientKeyId,
        },
        encrypted_key: encodeJson(wrappedCek),
      };
    } finally {
      encapsulationSeed.fill(0);
      wrappingIv.fill(0);
      sharedSecret?.fill(0);
      wrappingKey?.fill(0);
    }
  }

  private async unwrapContentEncryptionKey(
    envelope: SecureMessageEnvelope,
    recipientKeyPair: SecureMessageRecipientKeyPair,
  ): Promise<Uint8Array> {
    const recipientKeyId = assertKeyId(recipientKeyPair.keyId);
    const recipient = envelope.recipients.find(({ header }) => header.kid === recipientKeyId);
    if (!recipient) throw new Error('secure_message_recipient_not_found');
    const wrappedCek = decodeJson<Partial<WrappedContentEncryptionKey>>(recipient.encrypted_key);
    if (wrappedCek.v !== WRAP_VERSION
      || wrappedCek.kem !== 'ML-KEM-768'
      || wrappedCek.kdf !== 'HKDF-SHA-256'
      || wrappedCek.wrap !== 'A256GCM'
      || typeof wrappedCek.kemCiphertext !== 'string'
      || typeof wrappedCek.iv !== 'string'
      || typeof wrappedCek.ciphertext !== 'string'
      || typeof wrappedCek.tag !== 'string') {
      throw new Error('secure_message_recipient_wrap_invalid');
    }

    const sharedSecret = ml_kem768.decapsulate(
      decodeBase64Url(wrappedCek.kemCiphertext),
      recipientKeyPair.secretKey,
    );
    const wrappingKey = deriveRecipientWrappingKey(sharedSecret, envelope.protected, recipientKeyId);
    try {
      return gcm(
        wrappingKey,
        decodeBase64Url(wrappedCek.iv),
        textEncoder.encode(`${envelope.protected}.${recipientKeyId}.cek`),
      ).decrypt(joinCiphertextAndTag(
        decodeBase64Url(wrappedCek.ciphertext),
        decodeBase64Url(wrappedCek.tag),
      ));
    } finally {
      sharedSecret.fill(0);
      wrappingKey.fill(0);
    }
  }
}
