import { useState } from 'react'
import { toast } from 'sonner'
import { type Address } from 'viem'
import { useAccount } from 'wagmi'
import { CONTRACTS } from '../../config'
import { api } from '../../api/client'

interface TokenOption {
  address: Address
  symbol: string
  name: string
}

const KNOWN_TOKENS: TokenOption[] = [
  {
    address: CONTRACTS.jeju,
    symbol: 'JEJU',
    name: 'Jeju Network',
  },
  {
    address: '0xc1b0cfda1e2df8ed85ac78ae515ff96a4a12337c',
    symbol: 'MEME',
    name: 'Meme Coin',
  },
  {
    address: '0xe48503a26e840bf25584abc3d62f2fd1842f47de',
    symbol: 'DEGEN',
    name: 'Degen Token',
  },
  {
    address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    symbol: 'USDC',
    name: 'USD Coin',
  },
  {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    name: 'Wrapped Ether',
  },
]

const STRATEGIES = [
  { value: 'momentum', label: 'Momentum' },
  { value: 'mean_reversion', label: 'Mean Reversion' },
  { value: 'trend_following', label: 'Trend Following' },
  { value: 'volatility_targeting', label: 'Volatility Targeting' },
] as const

interface CreatePoolModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function CreatePoolModal({
  isOpen,
  onClose,
  onSuccess,
}: CreatePoolModalProps) {
  const { isConnected, address } = useAccount()
  const [selectedTokens, setSelectedTokens] = useState<Address[]>([])
  const [weights, setWeights] = useState<number[]>([])
  const [strategy, setStrategy] = useState<string>('momentum')
  const [swapFeeBps, setSwapFeeBps] = useState<number>(30)
  const [poolName, setPoolName] = useState('')
  const [poolSymbol, setPoolSymbol] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const handleTokenToggle = (address: Address) => {
    if (selectedTokens.includes(address)) {
      const newTokens = selectedTokens.filter((t) => t !== address)
      setSelectedTokens(newTokens)
      setWeights(newTokens.map(() => 100 / newTokens.length))
    } else {
      if (selectedTokens.length >= 8) {
        toast.error('Maximum 8 tokens allowed')
        return
      }
      const newTokens = [...selectedTokens, address]
      setSelectedTokens(newTokens)
      setWeights(newTokens.map(() => 100 / newTokens.length))
    }
  }

  const handleWeightChange = (index: number, value: number) => {
    const newWeights = [...weights]
    newWeights[index] = Math.max(0, Math.min(100, value))
    setWeights(newWeights)
  }

  const normalizeWeights = () => {
    const sum = weights.reduce((a, b) => a + b, 0)
    if (sum === 0) {
      setWeights(selectedTokens.map(() => 100 / selectedTokens.length))
      return
    }
    const normalized = weights.map((w) => (w / sum) * 100)
    setWeights(normalized)
  }

  const handleSubmit = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (selectedTokens.length < 2) {
      toast.error('Select at least 2 tokens')
      return
    }

    const weightSum = weights.reduce((a, b) => a + b, 0)
    if (Math.abs(weightSum - 100) > 0.01) {
      toast.error('Weights must sum to 100%')
      return
    }

    if (!address) {
      toast.error('Wallet address not available')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await api.tfmm.createPool(
        {
          tokens: selectedTokens,
          initialWeights: weights,
          strategy: strategy as 'momentum' | 'mean_reversion' | 'trend_following' | 'volatility_targeting',
          name: poolName || undefined,
          symbol: poolSymbol || undefined,
          swapFeeBps,
        },
        address,
      )

      // Handle response
      if (result.success && result.poolAddress) {
        toast.success(result.message || 'Pool created successfully!')
        onSuccess?.()
        onClose()
        // Reset form
        setSelectedTokens([])
        setWeights([])
        setPoolName('')
        setPoolSymbol('')
        setSwapFeeBps(30)
      } else {
        const errorMsg =
          result.error || result.message || 'Failed to create pool'
        toast.error(errorMsg)
        setIsSubmitting(false)
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create pool'
      toast.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pool-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        className="relative w-full max-w-2xl rounded-2xl border bg-surface border-default shadow-2xl overflow-hidden animate-modal-in max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-5 border-b border-default shrink-0">
          <h2 id="create-pool-title" className="text-xl font-bold text-primary">
            Create Liquidity Pool
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

          {/* Token Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-3">
              Select Tokens ({selectedTokens.length}/8)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {KNOWN_TOKENS.map((token) => {
                const isSelected = selectedTokens.includes(token.address)
                return (
                  <button
                    key={token.address}
                    type="button"
                    onClick={() => handleTokenToggle(token.address)}
                    className={`p-4 rounded-xl border-2 transition-all text-left hover:scale-[1.02] ${
                      isSelected
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
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

          {/* Weights */}
          {selectedTokens.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-primary">
                  Token Weights
                </label>
                <button
                  type="button"
                  onClick={normalizeWeights}
                  className="text-xs text-primary hover:text-primary-color transition-colors font-medium"
                >
                  Normalize
                </button>
              </div>
              <div className="space-y-3">
                {selectedTokens.map((tokenAddress, index) => {
                  const token = KNOWN_TOKENS.find((t) => t.address === tokenAddress)
                  const weight = weights[index] ?? 0
                  return (
                    <div
                      key={tokenAddress}
                      className="flex items-center gap-3 p-3 rounded-xl bg-surface-secondary"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-primary truncate">
                          {token?.symbol ?? 'Unknown'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={weight.toFixed(1)}
                          onChange={(e) =>
                            handleWeightChange(
                              index,
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="input flex-1 text-sm"
                        />
                        <span className="text-sm text-tertiary w-8">%</span>
                      </div>
                    </div>
                  )
                })}
                <div className="text-xs text-tertiary mt-2 px-1">
                  Total: {weights.reduce((a, b) => a + b, 0).toFixed(1)}%
                </div>
              </div>
            </div>
          )}

          {/* Strategy */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-2">
              Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="input w-full"
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Swap Fee */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-2">
              Swap Fee (basis points)
            </label>
            <input
              type="number"
              min="0"
              max="10000"
              value={swapFeeBps}
              onChange={(e) => setSwapFeeBps(parseInt(e.target.value) || 0)}
              className="input w-full"
              placeholder="30 (0.3%)"
            />
            <div className="text-xs text-tertiary mt-1">
              {(swapFeeBps / 100).toFixed(2)}% swap fee
            </div>
          </div>

          {/* Pool Name (Optional) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-2">
              Pool Name (Optional)
            </label>
            <input
              type="text"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              className="input w-full"
              placeholder="e.g., JEJU/USDC Pool"
            />
          </div>

          {/* Pool Symbol (Optional) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-primary mb-2">
              Pool Symbol (Optional)
            </label>
            <input
              type="text"
              value={poolSymbol}
              onChange={(e) => setPoolSymbol(e.target.value)}
              className="input w-full"
              placeholder="e.g., JEJU-USDC"
            />
          </div>
        </div>

        {/* Actions */}
        <footer className="flex gap-3 p-5 border-t border-default shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary flex-1"
            disabled={
              isSubmitting ||
              !isConnected ||
              selectedTokens.length < 2 ||
              Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.01
            }
          >
            {isSubmitting ? 'Creating...' : 'Create Pool'}
          </button>
        </footer>
      </div>
    </div>
  )
}
