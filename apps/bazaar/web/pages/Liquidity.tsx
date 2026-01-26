import { useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { type Address, formatUnits, parseUnits, erc20Abi } from 'viem'
import { CHAIN_ID } from '../../config'
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { InfoCard } from '../components/ui'
import {
  useTFMMPoolState,
  useTFMMUserBalance,
} from '../hooks/tfmm/useTFMMPools'

const TFMM_POOL_ABI = [
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountsIn', type: 'uint256[]' },
      { name: 'minLpOut', type: 'uint256' },
    ],
    outputs: [{ name: 'lpAmount', type: 'uint256' }],
  },
  // Custom errors from ITFMMPool
  {
    type: 'error',
    name: 'InvalidWeight',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WeightChangeTooLarge',
    inputs: [
      { name: 'change', type: 'uint256' },
      { name: 'maxAllowed', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'UpdateTooSoon',
    inputs: [{ name: 'blocksRemaining', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'InsufficientLiquidity',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SlippageExceeded',
    inputs: [
      { name: 'expected', type: 'uint256' },
      { name: 'actual', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroAmount',
    inputs: [],
  },
  // ERC20 errors from OpenZeppelin
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'error', type: 'bytes' },
    ],
  },
] as const

export default function LiquidityPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const poolAddress = searchParams.get('pool') as Address | null
  const { address, isConnected } = useAccount()
  const [token0Amount, setToken0Amount] = useState('')
  const [token1Amount, setToken1Amount] = useState('')

  const { poolState, isLoading: poolLoading } = useTFMMPoolState(poolAddress)
  const { balance: userBalance } = useTFMMUserBalance(poolAddress)
  const publicClient = usePublicClient()

  // Get token info and balances
  const token0 = poolState?.tokens[0]
  const token1 = poolState?.tokens[1]
  
  const { data: token0Info } = useReadContract({
    address: token0,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !!token0 },
  })
  
  const { data: token1Info } = useReadContract({
    address: token1,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !!token1 },
  })

  const { data: token0Decimals } = useReadContract({
    address: token0,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: !!token0 },
  })

  const { data: token1Decimals } = useReadContract({
    address: token1,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: !!token1 },
  })

  const { data: token0Balance } = useBalance({
    address,
    token: token0,
    query: { enabled: !!token0 && !!address },
  })

  const { data: token1Balance } = useBalance({
    address,
    token: token1,
    query: { enabled: !!token1 && !!address },
  })

  const [pendingApprovals, setPendingApprovals] = useState<string[]>([])
  const parseRevertReason = (error: unknown): string => {
    if (!error) return 'Unknown error'
    
    const errorStr = error instanceof Error ? error.message : String(error)
    
    // Check for error signature in the message
    const signatureMatch = errorStr.match(/signature:\s*(0x[0-9a-f]+)/i)
    if (signatureMatch) {
      const sig = signatureMatch[1].toLowerCase()
      // Map known error signatures to user-friendly messages
      const errorMap: Record<string, string> = {
        '0xe450d38c': 'Insufficient token balance. Check that you have enough tokens.',
        '0xfb8f41b2': 'Insufficient token allowance. Please approve tokens first.',
        '0xf186a50b': 'Token transfer failed. Check your balance and allowance.',
        '0x585b9263': 'Invalid weight configuration',
        '0x3e7c44d2': 'Weight change too large',
        '0x738a17e9': 'Update too soon',
        '0xbb55fd27': 'Insufficient liquidity in pool',
        '0x71c4efed': 'Slippage exceeded',
        '0xc1ab6dc1': 'Invalid token',
        '0x82b42900': 'Unauthorized',
        '0x1f2a2005': 'Zero amount not allowed',
      }
      if (errorMap[sig]) {
        return errorMap[sig]
      }
    }
    
    // Try to extract revert reason from various error formats
    const revertMatch = errorStr.match(/reverted with reason string ['"](.+?)['"]/)
    if (revertMatch) return revertMatch[1]
    
    const executionReverted = errorStr.match(/execution reverted: (.+)/)
    if (executionReverted) return executionReverted[1]
    
    const panicMatch = errorStr.match(/Panic\(0x([0-9a-f]+)\)/)
    if (panicMatch) {
      const code = parseInt(panicMatch[1], 16)
      const reasons: Record<number, string> = {
        1: 'Assertion failed',
        17: 'Arithmetic overflow',
        18: 'Division by zero',
        33: 'Invalid enum value',
        34: 'Storage access error',
        49: 'Pop empty array',
        50: 'Array out of bounds',
        65: 'Out of memory',
        81: 'Uninitialized function',
      }
      return reasons[code] ?? `Panic(0x${panicMatch[1]})`
    }
    
    // Check for common error patterns
    if (errorStr.includes('insufficient funds')) return 'Insufficient balance'
    if (errorStr.includes('transfer amount exceeds balance')) return 'Transfer amount exceeds balance'
    if (errorStr.includes('allowance')) return 'Insufficient allowance'
    if (errorStr.includes('Amount too small')) return 'Amount too small (minimum 0.000001 tokens)'
    if (errorStr.includes('Length mismatch')) return 'Token amounts length mismatch'
    if (errorStr.includes('Insufficient LP tokens')) return 'Insufficient LP tokens received'
    if (errorStr.includes('ERC20InsufficientBalance')) return 'Insufficient token balance'
    if (errorStr.includes('ERC20InsufficientAllowance')) return 'Insufficient token allowance'
    
    // Check if it's a viem contract error with data
    const contractError = error as { cause?: { data?: string; reason?: string; args?: unknown[] } }
    if (contractError.cause?.reason) {
      // Check if it's a decoded error with args
      if (contractError.cause.reason === 'ERC20InsufficientBalance' && contractError.cause.args) {
        const args = contractError.cause.args as [Address, bigint, bigint]
        const balance = formatUnits(args[1], 18)
        const needed = formatUnits(args[2], 18)
        return `Insufficient balance: have ${balance}, need ${needed}`
      }
      if (contractError.cause.reason === 'ERC20InsufficientAllowance' && contractError.cause.args) {
        const args = contractError.cause.args as [Address, bigint, bigint]
        const allowance = formatUnits(args[1], 18)
        const needed = formatUnits(args[2], 18)
        return `Insufficient allowance: have ${allowance}, need ${needed}`
      }
      return contractError.cause.reason
    }
    if (contractError.cause?.data) {
      // Try to decode error data
      const data = contractError.cause.data
      if (data.startsWith('0x08c379a0')) {
        // Error(string) selector
        return 'Contract reverted'
      }
    }
    
    return errorStr.slice(0, 200)
  }

  const { writeContract, writeContractAsync, data: txHash, isPending, error: writeError } = useWriteContract({
    onError: (error) => {
      const revertReason = parseRevertReason(error)
      console.error('[Liquidity] Transaction error:', error)
      toast.error(`Transaction failed: ${revertReason}`)
      setPendingApprovals([])
    },
  })
  const { isLoading: isConfirming, isSuccess, isError: txError, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    onError: (error) => {
      const revertReason = parseRevertReason(error)
      console.error('[Liquidity] Transaction receipt error:', error)
      toast.error(`Transaction failed: ${revertReason}`)
      setPendingApprovals([])
    },
  })

  // Check if transaction actually failed (status = 0)
  useEffect(() => {
    if (receipt) {
      if (receipt.status === 'reverted' || receipt.status === 0) {
        console.error('[Liquidity] Transaction reverted')
        // Try to get revert reason from receipt
        let errorMessage = 'Transaction was reverted on-chain'
        if (receipt.status === 'reverted') {
          errorMessage = 'Transaction reverted. Check contract requirements (minimum amounts, balances, etc.)'
        }
        toast.error(errorMessage)
        setPendingApprovals([])
      }
    }
  }, [receipt])

  useEffect(() => {
    if (isSuccess) {
      toast.success('Liquidity added successfully.')
      // Reset form
      setToken0Amount('')
      setToken1Amount('')
      setPendingApprovals([])
      // Invalidate pools query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['tfmm-pools', CHAIN_ID] })
      queryClient.invalidateQueries({ queryKey: ['tfmm-pool-state', poolAddress] })
      // Navigate back to pools page after a short delay to show success message
      setTimeout(() => {
        navigate('/pools')
      }, 1500)
    }
  }, [isSuccess, navigate, queryClient, poolAddress])

  useEffect(() => {
    if (txError) {
      const revertReason = parseRevertReason(txError)
      console.error('[Liquidity] Transaction failed:', txError)
      toast.error(`Transaction failed: ${revertReason}`)
      setPendingApprovals([])
    }
  }, [txError])

  useEffect(() => {
    if (writeError) {
      const revertReason = parseRevertReason(writeError)
      console.error('[Liquidity] Write error:', writeError)
      toast.error(`Transaction failed: ${revertReason}`)
      setPendingApprovals([])
    }
  }, [writeError])

  const handleAddLiquidity = async () => {
    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!poolAddress || !poolState) {
      toast.error('No pool selected or pool state not loaded')
      return
    }

    if (!publicClient) {
      toast.error('RPC client not available')
      return
    }

    const amount0 = parseFloat(token0Amount)
    const amount1 = parseFloat(token1Amount)
    if (
      Number.isNaN(amount0) ||
      Number.isNaN(amount1) ||
      amount0 <= 0 ||
      amount1 <= 0
    ) {
      toast.error('Enter valid amounts')
      return
    }

    // Build amounts array matching pool tokens
    // Get decimals for each token
    const tokenDecimals: number[] = []
    for (let i = 0; i < poolState.tokens.length; i++) {
      if (i === 0 && token0Decimals !== undefined) {
        tokenDecimals.push(token0Decimals)
      } else if (i === 1 && token1Decimals !== undefined) {
        tokenDecimals.push(token1Decimals)
      } else {
        // Fallback to 18 decimals if not available
        tokenDecimals.push(18)
      }
    }

    const amounts = poolState.tokens.map((token, index) => {
      if (index === 0 && token0Amount) {
        return parseUnits(token0Amount, tokenDecimals[0] ?? 18)
      }
      if (index === 1 && token1Amount) {
        return parseUnits(token1Amount, tokenDecimals[1] ?? 18)
      }
      return 0n // For pools with more than 2 tokens, set others to 0
    })

    // Check and approve tokens
    try {
      for (let i = 0; i < poolState.tokens.length; i++) {
        if (amounts[i] > 0n) {
          const tokenAddress = poolState.tokens[i]
          const allowance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, poolAddress],
          })

          if (allowance < amounts[i]) {
            setPendingApprovals((prev) => [...prev, tokenAddress])
            toast.info(`Approving token ${i + 1}...`)
            try {
              const approveTx = await writeContractAsync({
                address: tokenAddress,
                abi: erc20Abi,
                functionName: 'approve',
                args: [poolAddress, amounts[i]],
              })
              // Wait for approval
              await publicClient.waitForTransactionReceipt({ hash: approveTx })
              toast.success(`Token ${i + 1} approved`)
              setPendingApprovals((prev) => prev.filter((addr) => addr !== tokenAddress))
            } catch (error) {
              setPendingApprovals((prev) => prev.filter((addr) => addr !== tokenAddress))
              const revertReason = parseRevertReason(error)
              console.error('[Liquidity] Approval error:', error)
              toast.error(`Approval failed: ${revertReason}`)
              return
            }
          }
        }
      }

      // Simulate transaction first to catch errors early
      try {
        await publicClient.simulateContract({
          address: poolAddress,
          abi: TFMM_POOL_ABI,
          functionName: 'addLiquidity',
          args: [amounts, 0n],
          account: address,
        })
      } catch (simError) {
        const revertReason = parseRevertReason(simError)
        console.error('[Liquidity] Simulation error:', simError)
        toast.error(`Transaction will fail: ${revertReason}`)
        return
      }

      // Now add liquidity
      toast.info('Adding liquidity...')
      writeContract({
        address: poolAddress,
        abi: TFMM_POOL_ABI,
        functionName: 'addLiquidity',
        args: [amounts, 0n], // minLpOut = 0 for now
      })
    } catch (error) {
      const revertReason = parseRevertReason(error)
      console.error('[Liquidity] Error:', error)
      toast.error(`Failed to add liquidity: ${revertReason}`)
    }
  }

  const isSubmitting = isPending || isConfirming || pendingApprovals.length > 0

  return (
    <div className="max-w-lg mx-auto">
      <Link
        to="/pools"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Pools
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        💧 Add Liquidity
      </h1>

      {!poolAddress && (
        <InfoCard variant="warning" className="mb-6">
          No pool selected. Go to{' '}
          <Link to="/pools" className="underline">
            Pools
          </Link>{' '}
          and select a pool to add liquidity.
        </InfoCard>
      )}

      {poolAddress && !poolState && !poolLoading && (
        <InfoCard variant="warning" className="mb-6">
          Pool contracts pending deployment. TFMM pools will be available soon.
        </InfoCard>
      )}

      <div className="card p-6">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="token0-amount"
                className="text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {token0Info ? String(token0Info) : 'Token 1'}
              </label>
              {token0Balance && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Balance: {formatUnits(token0Balance.value, token0Balance.decimals)}
                </span>
              )}
            </div>
            <input
              id="token0-amount"
              type="number"
              value={token0Amount}
              onChange={(e) => setToken0Amount(e.target.value)}
              placeholder="0.0"
              className="input w-full"
            />
          </div>

          <div className="flex justify-center">
            <div
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              +
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="token1-amount"
                className="text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {token1Info ? String(token1Info) : 'Token 2'}
              </label>
              {token1Balance && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Balance: {formatUnits(token1Balance.value, token1Balance.decimals)}
                </span>
              )}
            </div>
            <input
              id="token1-amount"
              type="number"
              value={token1Amount}
              onChange={(e) => setToken1Amount(e.target.value)}
              placeholder="0.0"
              className="input w-full"
            />
          </div>

          {poolState && (
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: 'var(--text-tertiary)' }}>Fee Tier</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {Number(formatUnits(poolState.swapFee, 16)).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Your LP Balance
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {Number(formatUnits(userBalance, 18)).toFixed(4)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddLiquidity}
            disabled={
              isSubmitting ||
              !isConnected ||
              !poolAddress ||
              !token0Amount ||
              !token1Amount
            }
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {!isConnected
              ? 'Sign In'
              : !poolAddress
                ? 'Select a Pool'
                : isSubmitting
                  ? 'Adding Liquidity...'
                  : 'Add Liquidity'}
          </button>
        </div>
      </div>
    </div>
  )
}
