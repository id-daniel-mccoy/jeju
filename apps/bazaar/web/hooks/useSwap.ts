/**
 * useSwap Hook
 * Provides token swap functionality using XLPRouter for same-chain swaps
 * Falls back to direct token transfers when router isn't available
 */

import { getContract } from '@jejunetwork/config'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, erc20Abi, formatUnits } from 'viem'
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CHAIN_ID, NETWORK } from '../config'
import { useDEXPools } from './dex/useDEXPools'

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

// XLP Router ABI - minimal interface for swaps
const XLP_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokensV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokensV2',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETHV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'quoteForRouter',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'poolType', type: 'uint8' },
      { name: 'fee', type: 'uint24' },
    ],
  },
] as const

export interface SwapToken {
  symbol: string
  name: string
  address: Address
  decimals: number
  logoUrl?: string
}

export interface SwapQuote {
  inputAmount: bigint
  outputAmount: bigint
  priceImpact: number
  fee: number
  route: Address[]
}

export type SwapStatus =
  | 'idle'
  | 'quoting'
  | 'approving'
  | 'swapping'
  | 'success'
  | 'error'

// Native ETH token
const ETH_TOKEN: SwapToken = {
  symbol: 'ETH',
  name: 'Ether',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
}

// Zero address for comparison
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function useSwapRouter() {
  const routerAddress = safeGetContract('amm', 'XLPRouter', NETWORK) as
    | Address
    | undefined
  const wethAddress = safeGetContract('tokens', 'weth', NETWORK) as
    | Address
    | undefined

  return {
    routerAddress,
    wethAddress,
    isAvailable: !!routerAddress,
  }
}

export function useSwap() {
  const { address: userAddress, chain } = useAccount()
  const publicClient = usePublicClient()
  const {
    routerAddress,
    wethAddress,
    isAvailable: routerAvailable,
  } = useSwapRouter()

  const [status, setStatus] = useState<SwapStatus>('idle')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    writeContract,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const isCorrectChain = chain?.id === CHAIN_ID

  // Update status based on transaction state
  useEffect(() => {
    if (isPending) setStatus('swapping')
    else if (isConfirming) setStatus('swapping')
    else if (isSuccess) setStatus('success')
  }, [isPending, isConfirming, isSuccess])

  // Get quote for a swap
  const getQuote = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: bigint,
    ): Promise<SwapQuote | null> => {
      if (!publicClient || !routerAddress || amountIn <= 0n) {
        return null
      }

      setStatus('quoting')
      setError(null)

      // Determine actual addresses (use WETH for native ETH)
      const inputAddress =
        tokenIn.address === ZERO_ADDRESS ? wethAddress : tokenIn.address
      const outputAddress =
        tokenOut.address === ZERO_ADDRESS ? wethAddress : tokenOut.address

      if (!inputAddress || !outputAddress) {
        setError('WETH not configured')
        setStatus('idle')
        return null
      }

      const [amountOut, , fee] = await publicClient.readContract({
        address: routerAddress,
        abi: XLP_ROUTER_ABI,
        functionName: 'quoteForRouter',
        args: [inputAddress, outputAddress, amountIn],
      })

      // Calculate price impact (simplified)
      const inputValue = Number(formatUnits(amountIn, tokenIn.decimals))
      const outputValue = Number(formatUnits(amountOut, tokenOut.decimals))
      const priceImpact =
        inputValue > 0 ? Math.abs((1 - outputValue / inputValue) * 100) : 0

      const newQuote: SwapQuote = {
        inputAmount: amountIn,
        outputAmount: amountOut,
        priceImpact,
        fee: Number(fee) / 10000, // Convert bps to percentage
        route: [inputAddress, outputAddress],
      }

      setQuote(newQuote)
      setStatus('idle')
      return newQuote
    },
    [publicClient, routerAddress, wethAddress],
  )

  // Execute swap
  const executeSwap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: bigint,
      slippageBps: number = 50, // 0.5% default
    ) => {
      if (!userAddress || !routerAddress || !publicClient) {
        setError('Wallet not connected or router not available')
        return
      }

      setStatus('swapping')
      setError(null)

      // Get fresh quote
      const currentQuote = await getQuote(tokenIn, tokenOut, amountIn)
      if (!currentQuote) {
        setError('Failed to get quote')
        setStatus('error')
        return
      }

      // Calculate minimum output with slippage
      const minOutput =
        (currentQuote.outputAmount * BigInt(10000 - slippageBps)) / 10000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800) // 30 minutes

      const isETHIn = tokenIn.address === ZERO_ADDRESS
      const isETHOut = tokenOut.address === ZERO_ADDRESS

      // Approve token if not ETH
      if (!isETHIn) {
        setStatus('approving')
        const allowance = await publicClient.readContract({
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddress, routerAddress],
        })

        if (allowance < amountIn) {
          writeContract({
            address: tokenIn.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, amountIn],
          })
          return // Will continue after approval
        }
      }

      // Execute swap based on token types
      setStatus('swapping')

      if (isETHIn && !isETHOut) {
        // ETH -> Token
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactETHForTokensV2',
          args: [minOutput, currentQuote.route, userAddress, deadline],
          value: amountIn,
        })
      } else if (!isETHIn && isETHOut) {
        // Token -> ETH
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactTokensForETHV2',
          args: [
            amountIn,
            minOutput,
            currentQuote.route,
            userAddress,
            deadline,
          ],
        })
      } else {
        // Token -> Token
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactTokensForTokensV2',
          args: [
            amountIn,
            minOutput,
            currentQuote.route,
            userAddress,
            deadline,
          ],
        })
      }
    },
    [userAddress, routerAddress, publicClient, writeContract, getQuote],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setQuote(null)
    setError(null)
    resetWrite()
  }, [resetWrite])

  return {
    // State
    status,
    quote,
    error,
    txHash,
    isCorrectChain,
    routerAvailable,

    // Actions
    getQuote,
    executeSwap,
    reset,
  }
}

/**
 * Fetches tokens available for swapping
 * 
 * Gets tokens directly from DEX pools (V2 pairs) that have liquidity
 * This ensures tokens appear immediately after pools are created and funded
 */
export function useSwapTokens() {
  const { data: dexPools = [], isLoading: poolsLoading } = useDEXPools()
  const { wethAddress } = useSwapRouter()

  // Extract unique tokens from DEX pools with liquidity
  const tokens = useMemo((): SwapToken[] => {
    const tokenMap = new Map<Address, SwapToken>()
    
    // Always include ETH first (native ETH with zero address)
    tokenMap.set(ETH_TOKEN.address, ETH_TOKEN)

    // Extract tokens from pools that have liquidity
    for (const pool of dexPools) {
      // Only include tokens from pools with liquidity
      if (pool.reserve0 > 0n || pool.reserve1 > 0n) {
        // Check if token0 is WETH - if so, use native ETH instead to avoid duplicates
        const isToken0WETH = wethAddress && pool.token0.toLowerCase() === wethAddress.toLowerCase()
        if (isToken0WETH) {
          // Use native ETH (zero address) instead of WETH address
          tokenMap.set(ETH_TOKEN.address, ETH_TOKEN)
        } else if (pool.token0 && pool.token0 !== ETH_TOKEN.address) {
          // Only add if not already ETH and address is valid
          tokenMap.set(pool.token0, {
            symbol: pool.token0Symbol,
            name: pool.token0Symbol, // Could fetch name if needed
            address: pool.token0,
            decimals: pool.token0Decimals,
          })
        }

        // Check if token1 is WETH - if so, use native ETH instead to avoid duplicates
        const isToken1WETH = wethAddress && pool.token1.toLowerCase() === wethAddress.toLowerCase()
        if (isToken1WETH) {
          // Use native ETH (zero address) instead of WETH address
          tokenMap.set(ETH_TOKEN.address, ETH_TOKEN)
        } else if (pool.token1 && pool.token1 !== ETH_TOKEN.address) {
          // Only add if not already ETH and address is valid
          tokenMap.set(pool.token1, {
            symbol: pool.token1Symbol,
            name: pool.token1Symbol, // Could fetch name if needed
            address: pool.token1,
            decimals: pool.token1Decimals,
          })
        }
      }
    }

    // Convert to array, ensuring ETH is first
    const tokenArray = Array.from(tokenMap.values())
    const ethIndex = tokenArray.findIndex((t) => t.address === ETH_TOKEN.address)
    if (ethIndex > 0) {
      const eth = tokenArray.splice(ethIndex, 1)[0]
      tokenArray.unshift(eth)
    } else if (ethIndex === -1) {
      tokenArray.unshift(ETH_TOKEN)
    }

    return tokenArray
  }, [dexPools, wethAddress])

  return { tokens, isLoading: poolsLoading }
}

// Export ETH token for convenience
export { ETH_TOKEN }
