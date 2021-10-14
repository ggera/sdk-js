/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

/**
 * @packageDocumentation
 * @module Deposit
 */

import type { AccountId, Balance } from '@polkadot/types/interfaces'
import { Struct } from '@polkadot/types'

/**
 * An on-chain deposit, which includes the deposit owner and the amount of tokens locked.
 */
export interface Deposit extends Struct {
  owner: AccountId
  amount: Balance
}