/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import type { HexString } from '@polkadot/util/types'

import { ApiPromise, WsProvider } from '@polkadot/api'
import { Metadata, TypeRegistry } from '@polkadot/types'

import metaStatic from './metadata/spiritnet.json'

// adapted from https://github.com/polkadot-js/apps/blob/master/packages/test-support/src/api/createAugmentedApi.ts
export type StaticMetadata =
  | Uint8Array
  | HexString
  | Map<string, unknown>
  | Record<string, unknown>

export function createRegistryFromMetadata(
  meta: StaticMetadata = metaStatic
): TypeRegistry {
  const registry = new TypeRegistry()
  const metadata = new Metadata(registry, meta)

  registry.setMetadata(metadata)
  return registry
}

export function createAugmentedApi(
  meta: StaticMetadata = metaStatic
): ApiPromise {
  const registry = new TypeRegistry()
  const metadata = new Metadata(registry, meta)

  registry.setMetadata(metadata)

  const api = new ApiPromise({
    provider: new WsProvider('ws://', false),
    registry,
  })

  api.injectMetadata(metadata, true)

  return api
}
