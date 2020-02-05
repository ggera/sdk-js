import { Header, Index } from '@polkadot/types/interfaces/types'
import { UInt } from '@polkadot/types'
import { ApiPromise } from '@polkadot/api'
import { getCached } from '../blockchainApiConnection'
import Identity from '../identity/Identity'
import Blockchain from './Blockchain'

describe('Blockchain', async () => {
  xit('should get stats', async () => {
    const blockchainSingleton = await getCached()
    const stats = await blockchainSingleton.getStats()
    expect(stats).toEqual({
      chain: 'KILT Testnet',
      nodeName: 'substrate-node',
      nodeVersion: '0.9.0',
    })
  })

  xit('should listen to blocks', async done => {
    const listener = (header: Header): void => {
      console.log(`Best block number ${header.number}`)
      done()
    }
    const blockchainSingleton = await getCached()

    const subscriptionId = await blockchainSingleton.listenToBlocks(listener)
    expect(subscriptionId).toBeGreaterThanOrEqual(0)
    console.log(`Subscription Id: ${subscriptionId}`)
  }, 20000)

  it('should increment nonce for account', async () => {
    const chain = new Blockchain({} as ApiPromise)
    const alice = Identity.buildFromURI('//Alice')
    const initialNonce = new UInt(Math.random() * 10 + 1) as Index
    chain.accountNonces.set(alice.address, initialNonce)
    // eslint-disable-next-line dot-notation
    const incrNonce = await chain['retrieveNonce'](alice.address)
    expect(incrNonce.toNumber()).toEqual(initialNonce.toNumber())
    expect(chain.accountNonces.get(alice.address)!.toNumber()).toEqual(
      initialNonce.toNumber() + 1
    )
  })
  it('should return incrementing nonces', async () => {
    const alice = Identity.buildFromURI('//Alice')
    const promisedNonces: Array<Promise<Index>> = []
    const chain = new Blockchain({} as ApiPromise)
    chain.accountNonces.set(alice.address, new UInt(0) as Index)
    for (let i = 0; i < 25; i += 1) {
      promisedNonces.push(chain.getNonce(alice.address))
    }
    const nonces = await Promise.all(promisedNonces)
    expect(nonces.length).toEqual(25)
    nonces.forEach((value, index) => {
      expect(value.toNumber()).toEqual(new UInt(index).toNumber())
    })
  })

  it('should return seperate incrementing nonces per account', async () => {
    const alice = Identity.buildFromURI('//Alice')
    const bob = Identity.buildFromURI('//Bob')
    const alicePromisedNonces: Array<Promise<Index>> = []
    const bobPromisedNonces: Array<Promise<Index>> = []
    const chain = new Blockchain({} as ApiPromise)
    chain.accountNonces.set(alice.address, new UInt(0) as Index)
    chain.accountNonces.set(bob.address, new UInt(0) as Index)
    for (let i = 0; i < 50; i += 1) {
      if (i % 2 === 0) {
        alicePromisedNonces.push(chain.getNonce(alice.address))
      } else bobPromisedNonces.push(chain.getNonce(bob.address))
    }
    const aliceNonces = await Promise.all(alicePromisedNonces)
    const bobNonces = await Promise.all(alicePromisedNonces)

    expect(aliceNonces.length).toEqual(25)
    expect(bobNonces.length).toEqual(25)
    aliceNonces.forEach((value, index) => {
      expect(value.toNumber()).toEqual(new UInt(index).toNumber())
    })
    bobNonces.forEach((value, index) => {
      expect(value.toNumber()).toEqual(new UInt(index).toNumber())
    })
  })
})
