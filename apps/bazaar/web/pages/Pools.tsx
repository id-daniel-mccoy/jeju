// NOTE: TFMM pools temporarily disabled - focusing on DEX pools for swaps
// This page now shows DEX pools (V2 pairs) for swaps via XLPRouter
// TODO: Re-enable TFMM pools after team discussion

import { Droplets, Search, TrendingUp } from 'lucide-react'
import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { type Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { CreateDEXPoolModal } from '../components/CreateDEXPoolModal'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { EmptyState, Grid, InfoCard, PageHeader, StatCard } from '../components/ui'
import { useDEXPools, type DEXPool } from '../hooks/dex/useDEXPools'
import { useTokenPrices } from '../hooks/usePriceOracle'

type DEXPoolWithUSD = DEXPool & {
  usdValue: number
  usdValue0: number
  usdValue1: number
}

// Helper function to format USD
function formatTokenUsd(amount: number, decimals = 2): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return '<$0.01'
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(2)}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

// Helper function to calculate USD value
function calculateUsdValue(amount: bigint, decimals: number, priceUsd: number): number {
  const formatted = formatUnits(amount, decimals)
  return parseFloat(formatted) * priceUsd
}

type SortField = 'tvl' | 'apy' | 'volume' | 'name'
type SortDirection = 'asc' | 'desc'

interface DEXPoolRowProps {
  pool: DEXPoolWithUSD
  isSelected: boolean
  onSelect: () => void
}

function DEXPoolRow({ pool, isSelected, onSelect }: DEXPoolRowProps) {
  return (
    <article
      className={`card mb-3 transition-all duration-200 ${
        isSelected ? 'ring-2 ring-primary-color' : ''
      }`}
      style={{ borderColor: isSelected ? 'var(--color-primary)' : undefined }}
    >
      <button
        type="button"
        className="w-full p-4 text-left"
        onClick={onSelect}
        aria-expanded={isSelected}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Pool Info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-primary truncate">
                {pool.token0Symbol} / {pool.token1Symbol}
              </h3>
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium uppercase bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                V2
              </span>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4 sm:gap-8 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">TVL</p>
              <p className="font-semibold text-primary">
                {pool.usdValue && pool.usdValue > 0
                  ? formatTokenUsd(pool.usdValue)
                  : pool.tvl}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">Reserve 0</p>
              <p className="font-semibold text-primary">
                {formatUnits(pool.reserve0, pool.token0Decimals).slice(0, 8)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">Reserve 1</p>
              <p className="font-semibold text-primary">
                {formatUnits(pool.reserve1, pool.token1Decimals).slice(0, 8)}
              </p>
            </div>
          </div>

          {/* Action */}
          <Link
            to={`/liquidity?pool=${pool.address}&type=dex`}
            className="btn-primary text-sm py-2 px-4 sm:ml-4"
            onClick={(e) => e.stopPropagation()}
          >
            Add
          </Link>
        </div>
      </button>

      {/* Expanded Details */}
      {isSelected && (
        <div
          className="px-4 pb-4 pt-0 border-t animate-fade-in"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            <div>
              <p className="text-xs text-tertiary">Token 0</p>
              <p className="font-medium text-primary">{pool.token0Symbol}</p>
              <p className="text-xs text-tertiary font-mono">
                {pool.token0.slice(0, 6)}...{pool.token0.slice(-4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Token 1</p>
              <p className="font-medium text-primary">{pool.token1Symbol}</p>
              <p className="text-xs text-tertiary font-mono">
                {pool.token1.slice(0, 6)}...{pool.token1.slice(-4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Swap Fee</p>
              <p className="font-medium text-primary">0.3%</p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Total Supply</p>
              <p className="font-medium text-primary">
                {formatUnits(pool.totalSupply, 18).slice(0, 10)} LP
              </p>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

export default function PoolsPage() {
  const { isConnected } = useAccount()
  const { data: dexPools = [], isLoading, refetch, error: poolsError } = useDEXPools()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('tvl')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedPool, setSelectedPool] = useState<Address | null>(null)

  // Refetch pools when modal closes (in case a pool was created)
  useEffect(() => {
    if (!showCreateModal) {
      // Small delay to ensure transaction is confirmed
      const timer = setTimeout(() => {
        refetch()
      }, 3000) // Increased delay to ensure transaction is confirmed
      return () => clearTimeout(timer)
    }
    return undefined
  }, [showCreateModal, refetch])

  // Collect all unique token addresses for price fetching
  const tokenAddresses = useMemo(() => {
    const addresses = new Set<Address>()
    for (const pool of dexPools) {
      addresses.add(pool.token0)
      addresses.add(pool.token1)
    }
    return Array.from(addresses)
  }, [dexPools])

  // Fetch prices for all tokens
  const { data: tokenPrices = new Map() } = useTokenPrices(tokenAddresses)

  // Calculate USD values for each pool
  const poolsWithUSD = useMemo((): DEXPoolWithUSD[] => {
    return dexPools.map((pool) => {
      const price0 = tokenPrices.get(pool.token0)?.priceUSD ?? 0
      const price1 = tokenPrices.get(pool.token1)?.priceUSD ?? 0
      
      const usdValue0 = calculateUsdValue(pool.reserve0, pool.token0Decimals, price0)
      const usdValue1 = calculateUsdValue(pool.reserve1, pool.token1Decimals, price1)
      const totalUSD = usdValue0 + usdValue1

      return {
        ...pool,
        usdValue: totalUSD,
        usdValue0,
        usdValue1,
      }
    })
  }, [dexPools, tokenPrices])

  // Filter and sort pools
  const filteredPools = useMemo(() => {
    return poolsWithUSD
      .filter(
        (pool) =>
          pool.token0Symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          pool.token1Symbol.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a, b) => {
        if (sortField === 'name') {
          const aName = `${a.token0Symbol}/${a.token1Symbol}`
          const bName = `${b.token0Symbol}/${b.token1Symbol}`
          return sortDirection === 'asc'
            ? aName.localeCompare(bName)
            : bName.localeCompare(aName)
        }

        let aVal: number
        let bVal: number
        switch (sortField) {
          case 'tvl':
            // Sort by USD value
            aVal = a.usdValue ?? 0
            bVal = b.usdValue ?? 0
            break
          case 'apy':
            // No APY data for DEX pools yet
            aVal = 0
            bVal = 0
            break
          case 'volume':
            // No volume data for DEX pools yet
            aVal = 0
            bVal = 0
            break
          default:
            aVal = 0
            bVal = 0
        }

        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      })
  }, [poolsWithUSD, searchQuery, sortField, sortDirection])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Calculate aggregate stats
  const totalTVL = poolsWithUSD.reduce((sum, p) => sum + p.usdValue, 0)

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="💧"
        title="Pools"
        description="Provide liquidity and earn trading fees on every swap"
        action={
          isConnected
            ? { label: 'Create Pool', onClick: () => setShowCreateModal(true) }
            : { label: 'Add Liquidity', href: '/liquidity' }
        }
      />

      {/* Stats Overview */}
      <Grid cols={3} className="mb-6">
        <StatCard
          icon={Droplets}
          label="Total Value Locked"
          value={totalTVL > 0 ? formatTokenUsd(totalTVL) : '$0.00'}
        />
        <StatCard
          icon={TrendingUp}
          label="Total Pools"
          value={dexPools.length.toString()}
        />
        <StatCard
          icon={Droplets}
          label="Active Pools"
          value={poolsWithUSD.filter((p) => p.usdValue > 0).length.toString()}
        />
      </Grid>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search pools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10 w-full"
            aria-label="Search pools"
          />
        </div>

        <div className="flex gap-2">
          {(['tvl', 'apy', 'volume'] as SortField[]).map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => toggleSort(field)}
              className={`px-3 py-2 rounded-lg text-xs font-medium uppercase transition-all focus-ring ${
                sortField === field
                  ? 'bg-primary-soft text-primary-color'
                  : 'bg-surface-secondary text-secondary hover:text-primary'
              }`}
            >
              {field === 'volume' ? '24h Vol' : field}
              {sortField === field && (
                <span className="ml-1">
                  {sortDirection === 'desc' ? '↓' : '↑'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Pool List */}
      {poolsError && (
        <InfoCard variant="error" className="mb-6">
          <p className="mb-2">Error loading pools: {poolsError instanceof Error ? poolsError.message : 'Unknown error'}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-secondary"
          >
            Retry
          </button>
        </InfoCard>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : filteredPools.length === 0 ? (
        <EmptyState
          icon="💧"
          title={searchQuery ? 'No Pools Found' : 'No DEX Pools Available'}
          description={
            searchQuery
              ? 'Try adjusting your search criteria'
              : 'Create the first DEX pool to start earning trading fees. V2 pools support any token pair.'
          }
          action={
            !searchQuery && isConnected
              ? { label: 'Create Pool', onClick: () => setShowCreateModal(true) }
              : undefined
          }
        />
      ) : (
        <div>
          {filteredPools.map((pool) => (
            <DEXPoolRow
              key={pool.address}
              pool={pool}
              isSelected={selectedPool === pool.address}
              onSelect={() =>
                setSelectedPool(
                  selectedPool === pool.address ? null : pool.address,
                )
              }
            />
          ))}
        </div>
      )}

      {/* Sign In CTA */}
      {!isConnected && (
        <div className="card p-6 mt-6 text-center bg-gradient-to-br from-orange-500/5 to-purple-500/5 border-dashed">
          <h3 className="text-lg font-semibold text-primary mb-2">
            Sign In to View Your Positions
          </h3>
          <p className="text-sm text-secondary">
            Sign in to see your LP positions and manage liquidity
          </p>
        </div>
      )}

      {/* Create DEX Pool Modal */}
      <CreateDEXPoolModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          refetch()
          setShowCreateModal(false)
        }}
      />
    </div>
  )
}
