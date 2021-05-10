import { SDKErrors } from '@kiltprotocol/utils'
import { TypeRegistry } from '@polkadot/types'
import type { Codec } from '@polkadot/types/types'
import type {
  DidSigned,
  PublicKeyEnum,
  ISigningKeyPair,
  UrlEnum,
  Nullable,
  IPublicKey,
  PublicKeySet,
  UrlEncoding,
} from './types'
import type {
  IDidCreationOperation,
  IDidDeletionOperation,
  IDidUpdateOperation,
  KeyId,
} from './types.chain'

export const KILT_DID_PREFIX = 'did:kilt:'

export function getDidFromIdentifier(identifier: string): string {
  return KILT_DID_PREFIX + identifier
}

export function getIdentifierFromDid(did: string): string {
  if (!did.startsWith(KILT_DID_PREFIX)) {
    throw SDKErrors.ERROR_INVALID_DID_PREFIX(did)
  }
  return did.substr(KILT_DID_PREFIX.length)
}

export function signCodec<PayloadType extends Codec>(
  payload: PayloadType,
  signer: ISigningKeyPair
): DidSigned<PayloadType> {
  const signature = {
    [signer.type]: signer.sign(payload.toU8a()),
  }
  return { payload, signature }
}

export function formatPublicKey(keypair: IPublicKey): PublicKeyEnum {
  const { type, publicKey } = keypair
  return { [type]: publicKey }
}

export function isIKeyPair(keypair: unknown): keypair is IPublicKey {
  if (typeof keypair === 'object') {
    const { publicKey, type } = keypair as any
    return publicKey instanceof Uint8Array && typeof type === 'string'
  }
  return false
}

export function encodeEndpointUrl(url: string): UrlEnum {
  const typedUrl: Record<string, UrlEncoding> = {}
  const matched = Array.from(['http', 'ftp', 'ipfs']).some((type) => {
    if (url.startsWith(type)) {
      typedUrl[type] = { payload: url }
      return true
    }
    return false
  })
  if (!matched)
    throw new Error(
      'only endpoint urls starting with http/https, ftp, and ipfs are accepted'
    )
  return typedUrl as UrlEnum
}

export function encodeDidCreate(
  typeRegistry: TypeRegistry,
  did: string,
  keys: PublicKeySet,
  endpointUrl?: string
): IDidCreationOperation {
  // build did create object
  const didCreateRaw = {
    did: getIdentifierFromDid(did),
    newAuthenticationKey: formatPublicKey(keys.authentication),
    newKeyAgreementKeys: [formatPublicKey(keys.encryption)],
    newAttestationKey: keys.attestation
      ? formatPublicKey(keys.attestation)
      : undefined,
    newDelegationKey: keys.delegation
      ? formatPublicKey(keys.delegation)
      : undefined,
    newEndpointUrl: endpointUrl ? encodeEndpointUrl(endpointUrl) : undefined,
  }
  return new (typeRegistry.getOrThrow<IDidCreationOperation>(
    'DidCreationOperation'
  ))(typeRegistry, didCreateRaw)
}

function matchKeyOperation(keypair: IPublicKey | undefined | null) {
  return keypair && typeof keypair === 'object'
    ? { Change: formatPublicKey(keypair) }
    : keypair === null
    ? { Delete: null }
    : { Ignore: null }
}

export function encodeDidUpdate(
  typeRegistry: TypeRegistry,
  did: string,
  txCounter: number,
  keysToUpdate: Partial<Nullable<PublicKeySet>>,
  verificationKeysToRemove: KeyId[] = [],
  newEndpointUrl?: string
): IDidUpdateOperation {
  const { authentication, encryption, attestation, delegation } = keysToUpdate
  const didUpdateRaw = {
    did: getIdentifierFromDid(did),
    newAuthKey: authentication ? formatPublicKey(authentication) : null,
    newKeyAgreementKey: encryption ? [formatPublicKey(encryption)] : [],
    newAttestationKey: matchKeyOperation(attestation),
    newDelegationKey: matchKeyOperation(delegation),
    verificationKeysToRemove,
    newEndpointUrl: newEndpointUrl
      ? encodeEndpointUrl(newEndpointUrl)
      : undefined,
    txCounter,
  }
  return new (typeRegistry.getOrThrow<IDidUpdateOperation>(
    'DidUpdateOperation'
  ))(typeRegistry, didUpdateRaw)
}

export function encodeDidDelete(
  typeRegistry: TypeRegistry,
  did: string,
  txCounter: number
): IDidDeletionOperation {
  return new (typeRegistry.getOrThrow<IDidDeletionOperation>(
    'DidDeletionOperation'
  ))(typeRegistry, {
    did: getIdentifierFromDid(did),
    txCounter,
  })
}