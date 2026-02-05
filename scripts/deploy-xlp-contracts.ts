#!/usr/bin/env bun

/**
 * Deploy XLP DEX Contracts Script
 * 
 * Checks if XLP contracts are deployed, deploys if missing, and updates contracts.json
 * 
 * Usage:
 *   bun run scripts/deploy-xlp-contracts.ts
 * 
 * Environment variables:
 *   RPC_URL - RPC endpoint (default: http://localhost:9545)
 *   PRIVATE_KEY - Deployer private key (default: Anvil account #0)
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createPublicClient, http, type Address } from 'viem'
import { jejuLocalnet } from '@jejunetwork/chains'

const ROOT_DIR = process.cwd()
const CONTRACTS_DIR = join(ROOT_DIR, 'packages/contracts')
const CONFIG_FILE = join(ROOT_DIR, 'packages/config/contracts.json')

// Default values - try common localnet RPC URLs
const DEFAULT_RPC_URLS = [
  'http://127.0.0.1:6546', // Jeju localnet L2 (from services.json)
  'http://localhost:6546', // Alternative localhost variant
  'http://127.0.0.1:9545', // Standard Anvil port
  'http://localhost:9545', // Alternative localhost variant
]
const DEFAULT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Anvil account #0

const PRIVATE_KEY = process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY

// Try to detect RPC URL from environment or try common ports
function detectRpcUrl(): string {
  if (process.env.RPC_URL) {
    return process.env.RPC_URL
  }
  if (process.env.L2_RPC_URL) {
    return process.env.L2_RPC_URL
  }
  if (process.env.JEJU_RPC_URL) {
    return process.env.JEJU_RPC_URL
  }
  
  // Try common ports
  for (const url of DEFAULT_RPC_URLS) {
    try {
      const client = createPublicClient({
        transport: http(url, { timeout: 2000 }),
      })
      // Quick check - this will throw if not available
      client.getChainId().catch(() => {})
      return url
    } catch {
      // Continue to next URL
    }
  }
  
  // Default fallback
  return DEFAULT_RPC_URLS[0]
}

const RPC_URL = detectRpcUrl()

interface ContractAddresses {
  weth: Address
  xlpRouter: Address
  xlpV2Factory: Address
  xlpV3Factory: Address
}

async function checkContractDeployed(address: Address, rpcUrl: string): Promise<boolean> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 5000 }),
    })
    
    const code = await client.getCode({ address })
    return code !== undefined && code !== '0x' && code.length > 2
  } catch (error) {
    console.error(`Error checking contract at ${address}:`, error)
    return false
  }
}

async function checkContractsDeployed(
  addresses: ContractAddresses,
  rpcUrl: string,
): Promise<boolean> {
  console.log('Checking if contracts are already deployed...')
  
  const checks = await Promise.all([
    checkContractDeployed(addresses.weth, rpcUrl),
    checkContractDeployed(addresses.xlpRouter, rpcUrl),
    checkContractDeployed(addresses.xlpV2Factory, rpcUrl),
    checkContractDeployed(addresses.xlpV3Factory, rpcUrl),
  ])
  
  const allDeployed = checks.every((deployed) => deployed)
  
  if (allDeployed) {
    console.log('✅ All XLP contracts are already deployed')
    return true
  }
  
  console.log('⚠️  Some contracts are missing or not deployed')
  return false
}

function getCurrentAddresses(): ContractAddresses | null {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    const localnet = config.localnet
    
    const weth = localnet?.tokens?.weth
    const xlpRouter = localnet?.amm?.XLPRouter
    const xlpV2Factory = localnet?.amm?.XLPV2Factory
    const xlpV3Factory = localnet?.amm?.XLPV3Factory
    
    if (weth && xlpRouter && xlpV2Factory && xlpV3Factory) {
      return {
        weth: weth as Address,
        xlpRouter: xlpRouter as Address,
        xlpV2Factory: xlpV2Factory as Address,
        xlpV3Factory: xlpV3Factory as Address,
      }
    }
  } catch (error) {
    console.error('Error reading contracts.json:', error)
  }
  
  return null
}

function deployContracts(rpcUrl: string): ContractAddresses {
  console.log('Deploying XLP contracts...')
  console.log(`RPC URL: ${rpcUrl}`)
  console.log(`Deployer: ${execSync(`cast wallet address ${PRIVATE_KEY}`, { encoding: 'utf-8' }).trim()}`)
  console.log('')
  
  if (!existsSync(CONTRACTS_DIR)) {
    throw new Error(`Contracts directory not found: ${CONTRACTS_DIR}`)
  }
  
  const scriptPath = join(CONTRACTS_DIR, 'script/DeployXLP.s.sol')
  if (!existsSync(scriptPath)) {
    throw new Error(`Deploy script not found: ${scriptPath}`)
  }
  
  const cmd = `forge script script/DeployXLP.s.sol:DeployXLP --rpc-url ${rpcUrl} --broadcast -vvv`
  
  console.log('Running forge script...')
  console.log(`Command: ${cmd}`)
  console.log('')
  
  try {
    const output = execSync(cmd, {
      cwd: CONTRACTS_DIR,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PRIVATE_KEY,
        RPC_URL: rpcUrl,
      },
      stdio: 'pipe',
    })
    
    // Parse addresses from forge output
    // Look for lines like:
    //   WETH9: 0x...
    //   XLPV2Factory: 0x...
    //   XLPV3Factory: 0x...
    //   XLPRouter: 0x...
    
    const lines = output.split('\n')
    const addresses: Partial<ContractAddresses> = {}
    
    for (const line of lines) {
      // Match patterns like "WETH9: 0x..." or "XLPRouter: 0x..."
      const wethMatch = line.match(/WETH9?:\s*(0x[a-fA-F0-9]{40})/i)
      if (wethMatch) {
        addresses.weth = wethMatch[1] as Address
      }
      
      const routerMatch = line.match(/XLPRouter:\s*(0x[a-fA-F0-9]{40})/i)
      if (routerMatch) {
        addresses.xlpRouter = routerMatch[1] as Address
      }
      
      const v2FactoryMatch = line.match(/XLPV2Factory:\s*(0x[a-fA-F0-9]{40})/i)
      if (v2FactoryMatch) {
        addresses.xlpV2Factory = v2FactoryMatch[1] as Address
      }
      
      const v3FactoryMatch = line.match(/XLPV3Factory:\s*(0x[a-fA-F0-9]{40})/i)
      if (v3FactoryMatch) {
        addresses.xlpV3Factory = v3FactoryMatch[1] as Address
      }
    }
    
    // Also check broadcast logs for addresses
    const broadcastDir = join(CONTRACTS_DIR, 'broadcast/DeployXLP.s.sol/31337')
    if (existsSync(broadcastDir)) {
      const runLatest = execSync(`ls -t ${broadcastDir} | head -1`, { encoding: 'utf-8' }).trim()
      const runDir = join(broadcastDir, runLatest)
      const runLatestJson = join(runDir, 'run-latest.json')
      
      if (existsSync(runLatestJson)) {
        const runData = JSON.parse(readFileSync(runLatestJson, 'utf-8'))
        const transactions = runData.transactions || []
        
        for (const tx of transactions) {
          const contractName = tx.contractName
          const address = tx.contractAddress
          
          if (address && contractName) {
            if (contractName.includes('WETH')) {
              addresses.weth = address as Address
            } else if (contractName.includes('XLPRouter')) {
              addresses.xlpRouter = address as Address
            } else if (contractName.includes('XLPV2Factory')) {
              addresses.xlpV2Factory = address as Address
            } else if (contractName.includes('XLPV3Factory')) {
              addresses.xlpV3Factory = address as Address
            }
          }
        }
      }
    }
    
    // Validate all addresses were found
    if (!addresses.weth || !addresses.xlpRouter || !addresses.xlpV2Factory || !addresses.xlpV3Factory) {
      console.error('Failed to parse all addresses from forge output')
      console.error('Found addresses:', addresses)
      console.error('\nFull output:')
      console.error(output)
      throw new Error('Failed to extract all contract addresses')
    }
    
    console.log('✅ Contracts deployed successfully!')
    console.log(`   WETH: ${addresses.weth}`)
    console.log(`   XLPV2Factory: ${addresses.xlpV2Factory}`)
    console.log(`   XLPV3Factory: ${addresses.xlpV3Factory}`)
    console.log(`   XLPRouter: ${addresses.xlpRouter}`)
    
    return addresses as ContractAddresses
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new Error(`Deployment failed: ${errorMsg}`)
  }
}

function updateContractsJson(addresses: ContractAddresses): void {
  console.log('\nUpdating contracts.json...')
  
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  
  if (!config.localnet) {
    config.localnet = {}
  }
  
  if (!config.localnet.tokens) {
    config.localnet.tokens = {}
  }
  
  if (!config.localnet.amm) {
    config.localnet.amm = {}
  }
  
  // Update addresses
  config.localnet.tokens.weth = addresses.weth
  config.localnet.amm.XLPRouter = addresses.xlpRouter
  config.localnet.amm.XLPV2Factory = addresses.xlpV2Factory
  config.localnet.amm.XLPV3Factory = addresses.xlpV3Factory
  
  // Write back to file
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  
  console.log('✅ contracts.json updated successfully')
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║         XLP DEX Contracts Deployment Script               ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  
  // Check if RPC is available - try multiple URLs if needed
  let rpcUrl = RPC_URL
  let client = createPublicClient({
    transport: http(rpcUrl, { timeout: 5000 }),
  })
  
  try {
    await client.getChainId()
    console.log(`✅ Connected to RPC: ${rpcUrl}`)
  } catch (error) {
    console.log(`⚠️  Failed to connect to ${rpcUrl}, trying other common ports...`)
    
    // Try other common ports
    let connected = false
    for (const url of DEFAULT_RPC_URLS) {
      if (url === rpcUrl) continue // Skip the one we already tried
      
      try {
        client = createPublicClient({
          transport: http(url, { timeout: 5000 }),
        })
        await client.getChainId()
        rpcUrl = url
        console.log(`✅ Connected to RPC: ${rpcUrl}`)
        connected = true
        break
      } catch {
        // Continue to next URL
      }
    }
    
    if (!connected) {
      console.error(`❌ Failed to connect to any RPC endpoint`)
      console.error('Tried:')
      for (const url of DEFAULT_RPC_URLS) {
        console.error(`  - ${url}`)
      }
      console.error('')
      console.error('Make sure your localnet is running (bun run dev)')
      console.error('Or set RPC_URL environment variable:')
      console.error('  RPC_URL=http://your-rpc-url:port bun run scripts/deploy-xlp-contracts.ts')
      process.exit(1)
    }
  }
  
  // Use detected RPC URL for rest of script
  const finalRpcUrl = rpcUrl
  
  console.log('')
  
  // Get current addresses from config
  const currentAddresses = getCurrentAddresses()
  
  if (currentAddresses) {
    // Check if contracts are actually deployed
    const deployed = await checkContractsDeployed(currentAddresses, finalRpcUrl)
    
    if (deployed) {
      console.log('\n✅ All contracts are deployed and verified')
      console.log('   No deployment needed')
      process.exit(0)
    }
    
    console.log('\n⚠️  Addresses in config but contracts not found on-chain')
    console.log('   This might be from a previous deployment or reset')
    console.log('   Proceeding with new deployment...')
    console.log('')
  } else {
    console.log('⚠️  No XLP contract addresses found in config')
    console.log('   Proceeding with deployment...')
    console.log('')
  }
  
  // Deploy contracts
  const addresses = deployContracts(rpcUrl)
  
  // Update config file
  updateContractsJson(addresses)
  
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Deployment Complete                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Contract addresses:')
  console.log(`  WETH:         ${addresses.weth}`)
  console.log(`  XLPV2Factory: ${addresses.xlpV2Factory}`)
  console.log(`  XLPV3Factory: ${addresses.xlpV3Factory}`)
  console.log(`  XLPRouter:    ${addresses.xlpRouter}`)
  console.log('')
  console.log('✅ contracts.json has been updated')
  console.log('')
}

main().catch((error) => {
  console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
