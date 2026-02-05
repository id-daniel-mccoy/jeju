import { useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { type Address, parseUnits, formatUnits } from 'viem'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { useDEXContracts } from '../hooks/dex/useDEXPools'
import { CONTRACTS, CHAIN_ID, NETWORK } from '../config'
import { erc20Abi } from 'viem'
import { getContract } from '@jejunetwork/config'

interface TokenOption {
  address: Address
  symbol: string
  name: string
  decimals: number
}

// Helper to safely get contract address
function safeGetContract(
  category: 'tokens',
  name: string,
): Address | undefined {
  try {
    const result = getContract(
      category,
      name,
      NETWORK as 'localnet' | 'testnet' | 'mainnet',
    )
    return result && result !== '' ? (result as Address) : undefined
  } catch {
    return undefined
  }
}

// Get token addresses from config
function getKnownTokens(): TokenOption[] {
  const wethAddress = safeGetContract('tokens', 'weth')
  const usdcAddress = safeGetContract('tokens', 'usdc')
  const jejuAddress = CONTRACTS.jeju

  const tokens: TokenOption[] = []

  // ETH (WETH) - first
  if (wethAddress) {
    tokens.push({
      address: wethAddress,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
    })
  }

  // USDC - second
  if (usdcAddress) {
    tokens.push({
      address: usdcAddress,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    })
  }

  // JEJU
  if (jejuAddress && jejuAddress !== '0x0000000000000000000000000000000000000000') {
    tokens.push({
      address: jejuAddress,
      symbol: 'JEJU',
      name: 'Jeju Network',
      decimals: 18,
    })
  }

  // MEME and DEGEN (hardcoded for localnet)
  tokens.push(
    {
      address: '0xc1b0cfda1e2df8ed85ac78ae515ff96a4a12337c' as Address,
      symbol: 'MEME',
      name: 'Meme Coin',
      decimals: 18,
    },
    {
      address: '0xe48503a26e840bf25584abc3d62f2fd1842f47de' as Address,
      symbol: 'DEGEN',
      name: 'Degen Token',
      decimals: 18,
    },
  )

  return tokens
}

const V2_FACTORY_ABI = [
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
] as const

interface CreateDEXPoolModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function CreateDEXPoolModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateDEXPoolModalProps) {
  const { isConnected, address } = useAccount()
  const { v2FactoryAddress } = useDEXContracts()
  const publicClient = usePublicClient()
  const queryClient = useQueryClient()
  const [token0, setToken0] = useState<Address | null>(null)
  const [token1, setToken1] = useState<Address | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const successHandledRef = useRef(false)
  
  const KNOWN_TOKENS = getKnownTokens()

  // Check if pair already exists
  const { data: existingPair } = useReadContract({
    address: v2FactoryAddress,
    abi: V2_FACTORY_ABI,
    functionName: 'getPair',
    args:
      token0 && token1 && token0 < token1
        ? [token0, token1]
        : token0 && token1
          ? [token1, token0]
          : undefined,
    query: {
      enabled: !!v2FactoryAddress && !!token0 && !!token1,
    },
  })

  const {
    writeContract,
    data: hash,
    error: writeError,
    isPending,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({
      hash,
    })

  // Reset success handler when hash changes (new transaction)
  useEffect(() => {
    if (hash) {
      successHandledRef.current = false
    }
  }, [hash])

  useEffect(() => {
    if (writeError) {
      toast.error(
        writeError.message || 'Failed to create pool. Please try again.',
      )
      setIsSubmitting(false)
      successHandledRef.current = false
    }
  }, [writeError])

  // Handle success - only run once per transaction hash
  useEffect(() => {
    if (isSuccess && hash && !successHandledRef.current && v2FactoryAddress) {
      successHandledRef.current = true
      toast.success('Pool created successfully!')
      // Invalidate pools query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['dex-pools', CHAIN_ID, v2FactoryAddress] })
      // Small delay to ensure transaction is confirmed before closing
      const timeoutId = setTimeout(() => {
        onSuccess?.()
        onClose()
        setToken0(null)
        setToken1(null)
        setIsSubmitting(false)
      }, 1500)
      
      // Cleanup function to prevent multiple calls
      return () => {
        clearTimeout(timeoutId)
      }
    }
  }, [isSuccess, hash, onSuccess, onClose, queryClient, v2FactoryAddress])

  // Reset success handler when modal closes or opens
  useEffect(() => {
    if (!isOpen) {
      successHandledRef.current = false
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!token0 || !token1) {
      toast.error('Please select both tokens')
      return
    }

    if (token0 === token1) {
      toast.error('Tokens must be different')
      return
    }

    if (!v2FactoryAddress) {
      toast.error('DEX factory not available')
      return
    }

    if (existingPair && existingPair !== '0x0000000000000000000000000000000000000000') {
      toast.error('Pool already exists for this pair')
      return
    }

    setIsSubmitting(true)

    try {
      writeContract({
        address: v2FactoryAddress,
        abi: V2_FACTORY_ABI,
        functionName: 'createPair',
        args: [token0, token1],
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create pool'
      toast.error(errorMessage)
      setIsSubmitting(false)
    }
  }

  const token0Option = token0 ? KNOWN_TOKENS.find((t) => t.address === token0) : null
  const token1Option = token1 ? KNOWN_TOKENS.find((t) => t.address === token1) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-dex-pool-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-surface border-default shadow-2xl overflow-hidden animate-modal-in max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-5 border-b border-default shrink-0">
          <h2
            id="create-dex-pool-title"
            className="text-xl font-bold text-primary"
          >
            Create DEX Pool (V2)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors focus-ring"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="p-5 overflow-y-auto flex-1">
          {!isConnected && (
            <div className="mb-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
              <p className="text-sm text-warning">
                Please connect your wallet to create a pool
              </p>
            </div>
          )}

          {!v2FactoryAddress && (
            <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-sm text-error">
                DEX factory not available. Please ensure contracts are deployed.
              </p>
            </div>
          )}

          {/* Token 0 Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-3">
              Token 0
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {KNOWN_TOKENS.map((token) => {
                const isSelected = token0 === token.address
                const isDisabled = token1 === token.address
                return (
                  <button
                    key={token.address}
                    type="button"
                    onClick={() => setToken0(token.address)}
                    disabled={isDisabled}
                    className={`p-4 rounded-xl border-2 transition-all text-left hover:scale-[1.02] ${
                      isSelected
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                        : isDisabled
                          ? 'border-default bg-surface-secondary opacity-50 cursor-not-allowed'
                          : 'border-default bg-surface-secondary hover:border-primary/50 hover:bg-surface-elevated'
                    }`}
                  >
                    <div className="font-semibold text-primary mb-1">
                      {token.symbol}
                    </div>
                    <div className="text-xs text-tertiary truncate">
                      {token.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Token 1 Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-3">
              Token 1
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {KNOWN_TOKENS.map((token) => {
                const isSelected = token1 === token.address
                const isDisabled = token0 === token.address
                return (
                  <button
                    key={token.address}
                    type="button"
                    onClick={() => setToken1(token.address)}
                    disabled={isDisabled}
                    className={`p-4 rounded-xl border-2 transition-all text-left hover:scale-[1.02] ${
                      isSelected
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                        : isDisabled
                          ? 'border-default bg-surface-secondary opacity-50 cursor-not-allowed'
                          : 'border-default bg-surface-secondary hover:border-primary/50 hover:bg-surface-elevated'
                    }`}
                  >
                    <div className="font-semibold text-primary mb-1">
                      {token.symbol}
                    </div>
                    <div className="text-xs text-tertiary truncate">
                      {token.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pool Info */}
          {token0 && token1 && (
            <div className="mb-6 p-4 rounded-xl bg-surface-secondary border border-default">
              <div className="text-sm text-tertiary mb-2">Pool Pair</div>
              <div className="text-lg font-semibold text-primary">
                {token0Option?.symbol} / {token1Option?.symbol}
              </div>
              {existingPair &&
                existingPair !== '0x0000000000000000000000000000000000000000' && (
                  <div className="mt-2 text-xs text-warning">
                    ⚠️ Pool already exists at {existingPair.slice(0, 6)}...
                    {existingPair.slice(-4)}
                  </div>
                )}
              <div className="mt-2 text-xs text-tertiary">
                Fee: 0.3% (standard V2 fee)
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <footer className="flex gap-3 p-5 border-t border-default shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={isSubmitting || isPending || isConfirming}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary flex-1"
            disabled={
              isSubmitting ||
              isPending ||
              isConfirming ||
              !isConnected ||
              !token0 ||
              !token1 ||
              !v2FactoryAddress ||
              (existingPair &&
                existingPair !== '0x0000000000000000000000000000000000000000')
            }
          >
            {isSubmitting || isPending || isConfirming
              ? 'Creating...'
              : 'Create Pool'}
          </button>
        </footer>
      </div>
    </div>
  )
}
