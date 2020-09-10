/**
 * KILT participants can communicate via a 1:1 messaging system.
 *
 * All messages are **encrypted** with the encryption keys of the involved identities.
 * Every time an actor sends data about an [[Identity]], they have to sign the message to prove access to the corresponding private key.
 *
 * The [[Message]] class exposes methods to construct and verify messages.
 *
 * @packageDocumentation
 * @module Messaging
 * @preferred
 */

import { AnyJson } from '@polkadot/types/types'
import {
  Attestation as AttestationPE,
  CombinedPresentation,
  CombinedPresentationRequest,
  InitiateAttestationRequest,
} from '@kiltprotocol/portablegabi'
import { DIDComm } from 'DIDComm-js'
import { v4 as uuid } from 'uuid'
import {
  naclKeypairFromSeed,
  encodeAddress,
  base58Decode,
} from '@polkadot/util-crypto'
import {
  Claim,
  DelegationNode,
  IAttestedClaim,
  IClaim,
  IDelegationBaseNode,
  IDelegationNode,
  Identity,
  IPublicIdentity,
  IRequestForAttestation,
  IAttestation,
  ICType,
} from '..'
import Crypto, { EncryptedAsymmetricString, decodeAddress } from '../crypto'
import ITerms from '../types/Terms'
import { IQuoteAgreement } from '../types/Quote'
import { validateSignature } from '../util/DataUtils'
import * as SDKErrors from '../errorhandling/SDKErrors'

const didcomm = new DIDComm()
const typestringReg = new RegExp(
  '(.*?)[/?&:;=]([a-z0-9._-]+)/([0-9.]+)/([a-z0-9._-]+)$'
)
const PROTOCOL_NAME = 'kilt-messaging'
const PROTOCOL_VERSION = '0.19'
const ERROR_CANT_HANDLE_PROTOCOL = (name: string, version: string) =>
  new Error(`no handler for protocol '${name}' version '${version}'`)

/**
 * - `body` - The body of the message, see [[MessageBody]].
 * - `createdAt` - The timestamp of the message construction.
 * - `receiverAddress` - The public SS58 address of the receiver.
 * - `senderAddress` - The public SS58 address of the sender.
 * - `senderBoxPublicKex` - The public encryption key of the sender.
 * - `messageId` - The message id.
 * - `inReplyTo` - The id of the parent-message.
 * - `references` - The references or the in-reply-to of the parent-message followed by the message-id of the parent-message.
 */
export interface IMessage {
  body: MessageBody
  createdAt: number
  receiverAddress: IPublicIdentity['address']
  senderAddress: IPublicIdentity['address']
  senderBoxPublicKey: IPublicIdentity['boxPublicKeyAsHex']
  messageId?: string
  receivedAt?: number
  inReplyTo?: IMessage['messageId']
  references?: Array<IMessage['messageId']>
}

/**
 * Removes the [[MessageBody]], parent-id and references from the [[Message]] and adds
 * four new fields: message, nonce, hash and signature.
 * - `message` - The encrypted body of the message.
 * - `nonce` - The encryption nonce.
 * - `hash` - The hash of the concatenation of message + nonce + createdAt.
 * - `signature` - The sender's signature on the hash.
 */
export type IEncryptedMessage = Pick<
  IMessage,
  | 'createdAt'
  | 'receiverAddress'
  | 'senderAddress'
  | 'senderBoxPublicKey'
  | 'messageId'
  | 'receivedAt'
> & {
  message: string
  nonce: string
  hash: string
  signature: string
}

export enum MessageBodyType {
  REQUEST_TERMS = 'request-terms',
  SUBMIT_TERMS = 'submit-terms',
  REJECT_TERMS = 'reject-terms',

  INITIATE_ATTESTATION = 'initiate-attestation',

  REQUEST_ATTESTATION_FOR_CLAIM = 'request-attestation-for-claim',
  SUBMIT_ATTESTATION_FOR_CLAIM = 'submit-attestation-for-claim',
  REJECT_ATTESTATION_FOR_CLAIM = 'reject-attestation-for-claim',

  REQUEST_CLAIMS_FOR_CTYPES = 'request-claims-for-ctypes',
  SUBMIT_CLAIMS_FOR_CTYPES_CLASSIC = 'submit-claims-for-ctypes-classic',
  SUBMIT_CLAIMS_FOR_CTYPES_PE = 'submit-claims-for-ctypes-pe',
  ACCEPT_CLAIMS_FOR_CTYPES = 'accept-claims-for-ctypes',
  REJECT_CLAIMS_FOR_CTYPES = 'reject-claims-for-ctypes',

  REQUEST_ACCEPT_DELEGATION = 'request-accept-delegation',
  SUBMIT_ACCEPT_DELEGATION = 'submit-accept-delegation',
  REJECT_ACCEPT_DELEGATION = 'reject-accept-delegation',
  INFORM_CREATE_DELEGATION = 'inform-create-delegation',
}

export function isKnownMessageType(type: string): type is MessageBodyType {
  return Object.values(MessageBodyType).includes(type as MessageBodyType)
}
export default class Message implements IMessage {
  /**
   * Make a didcomm message.
   *
   * @param recipients
   * @param sender
   * @param repudiable
   * @param recipients
   * @param sender
   * @param repudiable
   */
  public async getDIDComm(
    recipients: IPublicIdentity[],
    sender: Identity,
    repudiable = true
  ): Promise<string> {
    const messageBody = {
      content: this.body.content,
      '@id': this.messageId || uuid(),
      '@type': `kilt.io/${PROTOCOL_NAME}/${PROTOCOL_VERSION}/${this.body.type}`,
      sent_time: new Date(this.createdAt).toISOString(),
      // up to here this is a did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/basicmessage/1.0/message
      // below is included bc I haven't figured out how to get the boxing key from the signing key
      senderBoxPublicKey: sender.getBoxPublicKey(),
    }
    const recipientKeys: Array<nacl.SignKeyPair['publicKey']> = recipients.map(
      (pubId: IPublicIdentity): nacl.SignKeyPair['publicKey'] => {
        const signPublicKey = decodeAddress(pubId.address)
        return signPublicKey
      }
    )
    const senderKeyPair: nacl.SignKeyPair = naclKeypairFromSeed(sender.seed)
    await didcomm.ready
    return didcomm.pack_auth_msg_for_recipients(
      JSON.stringify(messageBody),
      recipientKeys,
      {
        publicKey: senderKeyPair.publicKey,
        privateKey: senderKeyPair.secretKey,
        keyType: 'ed25519',
      },
      !repudiable
    )
  }

  public static async decryptDIDComm(
    message: string,
    recipient: Identity
  ): Promise<IMessage> {
    const recKeyPair: nacl.SignKeyPair = naclKeypairFromSeed(recipient.seed)
    await didcomm.ready
    const unpacked = await didcomm.unpackMessage(message, {
      publicKey: recKeyPair.publicKey,
      privateKey: recKeyPair.secretKey,
      keyType: 'ed25519',
    })
    const contents = JSON.parse(unpacked.message)
    let type: MessageBodyType | null = null
    if (typeof contents['@type'] === 'string') {
      const captures = contents['@type'].match(typestringReg)
      console.log(captures?.length)

      if (captures?.length === 5) {
        const [, , name, version, typestr] = captures
        if (name !== PROTOCOL_NAME || version !== PROTOCOL_VERSION)
          throw ERROR_CANT_HANDLE_PROTOCOL(name, version)
        if (isKnownMessageType(typestr)) {
          type = typestr
        } else throw new Error(`unknown message type: '${typestr}'`)
      }
    }
    if (!type) throw new Error('no or invalid @type URI in message')
    const body: IMessage['body'] = {
      content: contents.content,
      type,
    }
    const createdAt = new Date(contents.sent_time)
    const senderSignPublicKey = base58Decode(unpacked.senderKey)
    const receiverSignPublicKey = base58Decode(unpacked.recipientKey)
    return {
      body,
      createdAt: createdAt.getTime(),
      senderBoxPublicKey: contents.senderBoxPublicKey || '',
      receiverAddress: encodeAddress(receiverSignPublicKey),
      senderAddress: encodeAddress(senderSignPublicKey),
    }
  }

  /**
   * [STATIC] Verifies that the sender of a [[Message]] is also the owner of it, e.g the owner's and sender's public keys match.
   *
   * @param message The [[Message]] object which needs to be decrypted.
   * @param message.body The body of the [[Message]] which depends on the [[MessageBodyType]].
   * @param message.senderAddress The sender's public SS58 address of the [[Message]].
   * @throws When the sender does not match the owner of the in the Message supplied Object.
   * @throws [[SUBMIT_ATTESTATION_FOR_CLAIM]], [[SUBMIT_CLAIMS_FOR_CTYPES_CLASSIC]], [[ERROR_IDENTITY_MISMATCH]].
   *
   */
  public static ensureOwnerIsSender({ body, senderAddress }: IMessage): void {
    switch (body.type) {
      case MessageBodyType.REQUEST_ATTESTATION_FOR_CLAIM:
        {
          const requestAttestation = body
          if (
            requestAttestation.content.requestForAttestation.claim.owner !==
            senderAddress
          ) {
            throw SDKErrors.ERROR_IDENTITY_MISMATCH('Claim', 'Sender')
          }
        }
        break
      case MessageBodyType.SUBMIT_ATTESTATION_FOR_CLAIM:
        {
          const submitAttestation = body
          if (submitAttestation.content.attestation.owner !== senderAddress) {
            throw SDKErrors.ERROR_IDENTITY_MISMATCH('Attestation', 'Sender')
          }
        }
        break
      case MessageBodyType.SUBMIT_CLAIMS_FOR_CTYPES_CLASSIC:
        {
          const submitClaimsForCtype: ISubmitClaimsForCTypesClassic = body
          submitClaimsForCtype.content.forEach((claim) => {
            if (claim.request.claim.owner !== senderAddress) {
              throw SDKErrors.ERROR_IDENTITY_MISMATCH('Claims', 'Sender')
            }
          })
        }
        break
      default:
    }
  }

  /**
   * [STATIC] Verifies that neither the hash of [[Message]] nor the sender's signature on the hash have been tampered with.
   *
   * @param encrypted The encrypted [[Message]] object which needs to be decrypted.
   * @param senderAddress The sender's public SS58 address of the [[Message]].
   * @throws When either the hash or the signature could not be verified against the calculations.
   * @throws [[ERROR_NONCE_HASH_INVALID]].
   *
   */
  public static ensureHashAndSignature(
    encrypted: IEncryptedMessage,
    senderAddress: IMessage['senderAddress']
  ): void {
    if (
      Crypto.hashStr(
        encrypted.message + encrypted.nonce + encrypted.createdAt
      ) !== encrypted.hash
    ) {
      throw SDKErrors.ERROR_NONCE_HASH_INVALID(
        { hash: encrypted.hash, nonce: encrypted.nonce },
        'Message'
      )
    }
    validateSignature(encrypted.hash, encrypted.signature, senderAddress)
  }

  /**
   * [STATIC] Symmetrically decrypts the result of [[Message.encrypt]].
   *
   * Uses [[Message.ensureHashAndSignature]] and [[Message.ensureOwnerIsSender]] internally.
   *
   * @param encrypted The encrypted message.
   * @param receiver The [[Identity]] of the receiver.
   * @throws When encrypted message couldn't be decrypted.
   * @throws When the decoded message could not be parsed.
   * @throws [[ERROR_DECODING_MESSAGE]], [[ERROR_PARSING_MESSAGE]].
   * @returns The original [[Message]].
   */
  public static decrypt(
    encrypted: IEncryptedMessage,
    receiver: Identity
  ): IMessage {
    // check validity of the message
    Message.ensureHashAndSignature(encrypted, encrypted.senderAddress)

    const ea: EncryptedAsymmetricString = {
      box: encrypted.message,
      nonce: encrypted.nonce,
    }
    const decoded: string | false = receiver.decryptAsymmetricAsStr(
      ea,
      encrypted.senderBoxPublicKey
    )
    if (!decoded) {
      throw SDKErrors.ERROR_DECODING_MESSAGE()
    }

    try {
      const messageBody: MessageBody = JSON.parse(decoded)
      const decrypted: IMessage = {
        ...encrypted,
        body: messageBody,
      }
      // make sure the sender is the owner of the identity
      Message.ensureOwnerIsSender(decrypted)

      return decrypted
    } catch (error) {
      throw SDKErrors.ERROR_PARSING_MESSAGE()
    }
  }

  public messageId?: string
  public receivedAt?: number
  public body: MessageBody
  public createdAt: number
  public receiverAddress: IMessage['receiverAddress']
  public senderAddress: IMessage['senderAddress']
  public senderBoxPublicKey: IMessage['senderBoxPublicKey']

  /**
   * Constructs a message which should be encrypted with [[Message.encrypt]] before sending to the receiver.
   *
   * @param body The body of the message.
   * @param sender The [[Identity]] of the sender.
   * @param receiver The [[PublicIdentity]] of the receiver.
   */
  public constructor(
    body: MessageBody,
    sender: Identity,
    receiver: IPublicIdentity
  ) {
    this.body = body
    this.createdAt = Date.now()
    this.receiverAddress = receiver.address
    this.senderAddress = sender.address
    this.senderBoxPublicKey = sender.getBoxPublicKey()

    const encryptedMessage: EncryptedAsymmetricString = sender.encryptAsymmetricAsStr(
      JSON.stringify(body),
      receiver.boxPublicKeyAsHex
    )
    this.message = encryptedMessage.box
    this.nonce = encryptedMessage.nonce

    const hashInput: string = this.message + this.nonce + this.createdAt
    this.hash = Crypto.hashStr(hashInput)
    this.signature = sender.signStr(this.hash)
  }

  private message: string
  private nonce: string
  private hash: string
  private signature: string

  /**
   * Encrypts the [[Message]] symmetrically as a string. This can be reversed with [[Message.decrypt]].
   *
   * @returns The encrypted version of the original [[Message]], see [[IEncryptedMessage]].
   */
  public encrypt(): IEncryptedMessage {
    return {
      messageId: this.messageId,
      receivedAt: this.receivedAt,
      message: this.message,
      nonce: this.nonce,
      createdAt: this.createdAt,
      hash: this.hash,
      signature: this.signature,
      receiverAddress: this.receiverAddress,
      senderAddress: this.senderAddress,
      senderBoxPublicKey: this.senderBoxPublicKey,
    }
  }
}

interface IMessageBodyBase {
  content: any
  type: MessageBodyType
}

export interface IRequestTerms extends IMessageBodyBase {
  content: IPartialClaim
  type: MessageBodyType.REQUEST_TERMS
}
export interface ISubmitTerms extends IMessageBodyBase {
  content: ITerms
  type: MessageBodyType.SUBMIT_TERMS
}
export interface IRejectTerms extends IMessageBodyBase {
  content: {
    claim: IPartialClaim
    legitimations: IAttestedClaim[]
    delegationId?: DelegationNode['id']
  }
  type: MessageBodyType.REJECT_TERMS
}

export interface IInitiateAttestation extends IMessageBodyBase {
  content: InitiateAttestationRequest
  type: MessageBodyType.INITIATE_ATTESTATION
}

export interface IRequestAttestationForClaim extends IMessageBodyBase {
  content: {
    requestForAttestation: IRequestForAttestation
    quote?: IQuoteAgreement
    prerequisiteClaims?: IClaim[]
  }
  type: MessageBodyType.REQUEST_ATTESTATION_FOR_CLAIM
}
export interface ISubmitAttestationForClaim extends IMessageBodyBase {
  content: {
    attestation: IAttestation
    attestationPE?: AttestationPE
  }
  type: MessageBodyType.SUBMIT_ATTESTATION_FOR_CLAIM
}
export interface IRejectAttestationForClaim extends IMessageBodyBase {
  content: IRequestForAttestation['rootHash']
  type: MessageBodyType.REJECT_ATTESTATION_FOR_CLAIM
}

export interface IRequestClaimsForCTypes extends IMessageBodyBase {
  content: {
    // Entries in the ctype hash array can be null, because ctypes are optional for portablegabi.
    ctypes: Array<ICType['hash'] | null>
    peRequest?: CombinedPresentationRequest
    allowPE: boolean
  }
  type: MessageBodyType.REQUEST_CLAIMS_FOR_CTYPES
}

export type ISubmitClaimsForCTypes =
  | ISubmitClaimsForCTypesClassic
  | ISubmitClaimsForCTypesPE

export interface ISubmitClaimsForCTypesClassic extends IMessageBodyBase {
  content: IAttestedClaim[]
  type: MessageBodyType.SUBMIT_CLAIMS_FOR_CTYPES_CLASSIC
}

export interface ISubmitClaimsForCTypesPE extends IMessageBodyBase {
  content: CombinedPresentation
  type: MessageBodyType.SUBMIT_CLAIMS_FOR_CTYPES_PE
}

export interface IAcceptClaimsForCTypes extends IMessageBodyBase {
  content: Array<ICType['hash']>
  type: MessageBodyType.ACCEPT_CLAIMS_FOR_CTYPES
}
export interface IRejectClaimsForCTypes extends IMessageBodyBase {
  content: Array<ICType['hash']>
  type: MessageBodyType.REJECT_CLAIMS_FOR_CTYPES
}

export interface IRequestAcceptDelegation extends IMessageBodyBase {
  content: {
    delegationData: {
      account: IDelegationBaseNode['account']
      id: IDelegationBaseNode['id']
      parentId: IDelegationNode['id']
      permissions: IDelegationNode['permissions']
      isPCR: boolean
    }
    metaData?: AnyJson
    signatures: {
      inviter: string
    }
  }
  type: MessageBodyType.REQUEST_ACCEPT_DELEGATION
}
export interface ISubmitAcceptDelegation extends IMessageBodyBase {
  content: {
    delegationData: IRequestAcceptDelegation['content']['delegationData']
    signatures: {
      inviter: string
      invitee: string
    }
  }
  type: MessageBodyType.SUBMIT_ACCEPT_DELEGATION
}
export interface IRejectAcceptDelegation extends IMessageBodyBase {
  content: IRequestAcceptDelegation['content']
  type: MessageBodyType.REJECT_ACCEPT_DELEGATION
}
export interface IInformCreateDelegation extends IMessageBodyBase {
  content: {
    delegationId: IDelegationBaseNode['id']
    isPCR: boolean
  }
  type: MessageBodyType.INFORM_CREATE_DELEGATION
}

export interface IPartialClaim extends Partial<IClaim> {
  cTypeHash: Claim['cTypeHash']
}

export type MessageBody =
  | IRequestTerms
  | ISubmitTerms
  | IRejectTerms
  //
  | IInitiateAttestation
  | IRequestAttestationForClaim
  | ISubmitAttestationForClaim
  | IRejectAttestationForClaim
  //
  | IRequestClaimsForCTypes
  | ISubmitClaimsForCTypesClassic
  | ISubmitClaimsForCTypesPE
  | IAcceptClaimsForCTypes
  | IRejectClaimsForCTypes
  //
  | IRequestAcceptDelegation
  | ISubmitAcceptDelegation
  | IRejectAcceptDelegation
  | IInformCreateDelegation
