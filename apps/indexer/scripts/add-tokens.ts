#!/usr/bin/env bun

/**
 * Script to manually add Token entities to the indexer database
 * This is needed when tokens are created outside of DEX pools
 */

import 'reflect-metadata'
import { Client } from 'pg'
import { config } from '../api/config'

const tokensToAdd = [
  {
    address: '0x0B306BF915C4d645ff596e518fAf3F9669b97016',
    chainId: 31337,
    symbol: 'JEJU',
    name: 'Jeju Network',
    decimals: 18,
    totalSupply: '1000000000000000000000000', // 1 trillion
    creatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Deployer
  },
  {
    address: '0xc1b0cfda1e2df8ed85ac78ae515ff96a4a12337c',
    chainId: 31337,
    symbol: 'MEME',
    name: 'Meme Coin',
    decimals: 18,
    totalSupply: '1000000000000000000000000000', // 1 trillion
    creatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Deployer
  },
  {
    address: '0xe48503a26e840bf25584abc3d62f2fd1842f47de',
    chainId: 31337,
    symbol: 'DEGEN',
    name: 'Degen Token',
    decimals: 18,
    totalSupply: '100000000000000000000000', // 100k
    creatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Deployer
  },
]

async function main() {
  console.log('Connecting to database...')
  const client = new Client({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPass,
  })

  await client.connect()
  console.log('Connected to database')

  const now = new Date().toISOString()

  for (const tokenData of tokensToAdd) {
    const tokenId = `${tokenData.chainId}-${tokenData.address.toLowerCase()}`
    const creatorId = tokenData.creatorAddress.toLowerCase()
    
    // Check if token already exists
    const existingCheck = await client.query(
      'SELECT id FROM token WHERE id = $1',
      [tokenId]
    )
    if (existingCheck.rows.length > 0) {
      console.log(`Token ${tokenData.symbol} (${tokenId}) already exists, skipping`)
      continue
    }

    // Get or create creator account
    const accountCheck = await client.query(
      'SELECT id FROM account WHERE id = $1',
      [creatorId]
    )
    if (accountCheck.rows.length === 0) {
      console.log(`Creating creator account: ${creatorId}`)
      await client.query(
        `INSERT INTO account (
          id, address, is_contract, first_seen_block, last_seen_block,
          transaction_count, total_value_sent, total_value_received,
          labels, first_seen_at, last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          creatorId,
          creatorId,
          false,
          0,
          0,
          0,
          '0',
          '0',
          '{}',
          now,
          now,
        ]
      )
    }

    // Create token entity
    await client.query(
      `INSERT INTO token (
        id, address, chain_id, symbol, name, decimals, total_supply,
        volume24h, volume_usd24h, tx_count24h, liquidity, liquidity_usd,
        holder_count, pool_count, verified, creator_id, created_at, last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        tokenId,
        tokenData.address.toLowerCase(),
        tokenData.chainId,
        tokenData.symbol,
        tokenData.name,
        tokenData.decimals,
        tokenData.totalSupply,
        '0',
        '0',
        0,
        '0',
        '0',
        0,
        0,
        true,
        creatorId,
        now,
        now,
      ]
    )

    console.log(`✅ Added token ${tokenData.symbol} (${tokenData.address})`)
  }

  await client.end()
  console.log('Done!')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
