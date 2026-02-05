import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getContract } from '@jejunetwork/config'
import { NETWORK } from '../../config'
import { type Address, createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { jejuLocalnet } from '@jejunetwork/chains'
import { CHAIN_ID } from '../../config'

// Safe contract getter that returns undefined instead of throwing
function safeGetContract(
  category: string,
  name: string,
  network: string,
): string | undefined {
  try {
    const result = getContract(
      category as 'amm' | 'tokens',
      name,
      network as 'localnet' | 'testnet' | 'mainnet',
    )
    return result && result !== '' ? result : undefined
  } catch {
    return undefined
  }
}

// ABI for V2 Factory
const V2_FACTORY_ABI = [
  {
    name: 'allPairsLength',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allPairs',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getPair',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createPair',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pair', type: 'address' }],
  },
] as const

// ABI for V2 Pair
const V2_PAIR_ABI = [
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ABI for ERC20
const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

export interface DEXPool {
  address: Address
  token0: Address
  token1: Address
  token0Symbol: string
  token1Symbol: string
  token0Decimals: number
  token1Decimals: number
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  tvl: string
}

export function useDEXContracts() {
  const v2FactoryAddress = safeGetContract('amm', 'XLPV2Factory', NETWORK) as Address | undefined
  const routerAddress = safeGetContract('amm', 'XLPRouter', NETWORK) as Address | undefined
  const wethAddress = safeGetContract('tokens', 'weth', NETWORK) as Address | undefined

  return {
    v2FactoryAddress,
    routerAddress,
    wethAddress,
    isAvailable: !!v2FactoryAddress && !!routerAddress,
  }
}

export function useDEXPools() {
  const { v2FactoryAddress, isAvailable } = useDEXContracts()
  const publicClient = usePublicClient()

  return useQuery({
    queryKey: ['dex-pools', CHAIN_ID, v2FactoryAddress],
    queryFn: async (): Promise<DEXPool[]> => {
      if (!v2FactoryAddress || !publicClient) return []

      const pairsLength = await publicClient.readContract({
        address: v2FactoryAddress,
        abi: V2_FACTORY_ABI,
        functionName: 'allPairsLength',
      })

      const pools: DEXPool[] = []

      // Fetch up to 100 pairs (reasonable limit)
      const maxPairs = pairsLength > 100n ? 100n : pairsLength

      for (let i = 0n; i < maxPairs; i++) {
        let pairAddress: Address
        try {
          pairAddress = await publicClient.readContract({
            address: v2FactoryAddress,
            abi: V2_FACTORY_ABI,
            functionName: 'allPairs',
            args: [i],
          })
        } catch (error) {
          console.error(`[useDEXPools] Failed to get pair at index ${i}:`, error)
          continue // Skip this pair and continue
        }

        // Skip zero address pairs
        if (pairAddress === '0x0000000000000000000000000000000000000000') {
          continue
        }

        let token0: Address
        let token1: Address
        let reserves: readonly [bigint, bigint, number]
        let totalSupply: bigint

        try {
          [token0, token1, reserves, totalSupply] = await Promise.all([
            publicClient.readContract({
              address: pairAddress,
              abi: V2_PAIR_ABI,
              functionName: 'token0',
            }),
            publicClient.readContract({
              address: pairAddress,
              abi: V2_PAIR_ABI,
              functionName: 'token1',
            }),
            publicClient.readContract({
              address: pairAddress,
              abi: V2_PAIR_ABI,
              functionName: 'getReserves',
            }),
            publicClient.readContract({
              address: pairAddress,
              abi: V2_PAIR_ABI,
              functionName: 'totalSupply',
            }),
          ])
        } catch (error) {
          console.error(`[useDEXPools] Failed to get pair data for ${pairAddress}:`, error)
          continue // Skip this pair and continue
        }

        // Get token symbols (don't skip empty pools - they need liquidity)
        const [token0SymbolRaw, token1SymbolRaw, token0Decimals, token1Decimals] = await Promise.all([
          publicClient.readContract({ address: token0, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'UNKNOWN'),
          publicClient.readContract({ address: token1, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'UNKNOWN'),
          publicClient.readContract({ address: token0, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
          publicClient.readContract({ address: token1, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
        ])
        
        // Get WETH address to normalize WETH symbol to ETH
        const wethAddress = safeGetContract('tokens', 'weth', NETWORK) as Address | undefined
        
        // Normalize WETH to ETH for display
        const token0Symbol = (wethAddress && token0.toLowerCase() === wethAddress.toLowerCase()) 
          ? 'ETH' 
          : (token0SymbolRaw as string)
        const token1Symbol = (wethAddress && token1.toLowerCase() === wethAddress.toLowerCase()) 
          ? 'ETH' 
          : (token1SymbolRaw as string)

        // Calculate TVL (simplified - assumes equal value)
        // Show empty pools too (they need liquidity)
        const reserve0Formatted = reserves[0] > 0n ? formatUnits(reserves[0], token0Decimals) : '0'
        const reserve1Formatted = reserves[1] > 0n ? formatUnits(reserves[1], token1Decimals) : '0'
        const tvl = reserves[0] === 0n && reserves[1] === 0n
          ? 'No liquidity yet'
          : `~${parseFloat(reserve0Formatted).toFixed(2)} ${token0Symbol} / ${parseFloat(reserve1Formatted).toFixed(2)} ${token1Symbol}`

        pools.push({
          address: pairAddress,
          token0,
          token1,
          token0Symbol: token0Symbol as string,
          token1Symbol: token1Symbol as string,
          token0Decimals: token0Decimals as number,
          token1Decimals: token1Decimals as number,
          reserve0: reserves[0],
          reserve1: reserves[1],
          totalSupply,
          tvl,
        })
      }

      return pools
    },
    enabled: isAvailable && !!publicClient,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

export function useDEXPool(token0: Address | undefined, token1: Address | undefined) {
  const { v2FactoryAddress } = useDEXContracts()
  const publicClient = usePublicClient()

  return useReadContract({
    address: v2FactoryAddress,
    abi: V2_FACTORY_ABI,
    functionName: 'getPair',
    args: token0 && token1 ? [token0, token1] : undefined,
    query: {
      enabled: !!v2FactoryAddress && !!token0 && !!token1 && !!publicClient,
    },
  })
}
