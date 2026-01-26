#!/usr/bin/env bun

/**
 * Kill all processes using ports configured in the Jeju network
 * This script reads all port configurations and kills any processes using them
 */

import { execSync } from 'node:child_process'
import {
  CORE_PORTS,
  INFRA_PORTS,
  VENDOR_PORTS,
} from '../packages/config/ports'

interface PortInfo {
  name: string
  port: number
  category: 'core' | 'infra' | 'vendor'
}

/**
 * Get all configured ports from the config
 */
function getAllPorts(): PortInfo[] {
  const ports: PortInfo[] = []

  // Core ports
  for (const [name, config] of Object.entries(CORE_PORTS)) {
    ports.push({
      name,
      port: config.get(),
      category: 'core',
    })
  }

  // Infrastructure ports
  for (const [name, config] of Object.entries(INFRA_PORTS)) {
    ports.push({
      name,
      port: config.get(),
      category: 'infra',
    })
  }

  // Vendor ports
  for (const [name, config] of Object.entries(VENDOR_PORTS)) {
    ports.push({
      name,
      port: config.get(),
      category: 'vendor',
    })
  }

  // Remove duplicates (same port used by multiple services)
  const uniquePorts = new Map<number, PortInfo>()
  for (const portInfo of ports) {
    if (!uniquePorts.has(portInfo.port)) {
      uniquePorts.set(portInfo.port, portInfo)
    } else {
      // Keep the first one but note it's used by multiple services
      const existing = uniquePorts.get(portInfo.port)!
      existing.name = `${existing.name}, ${portInfo.name}`
    }
  }

  return Array.from(uniquePorts.values())
}

/**
 * Get process IDs using a specific port
 */
function getPidsOnPort(port: number): number[] {
  try {
    // Try lsof first (Linux/macOS)
    const output = execSync(`lsof -ti:${port} 2>/dev/null`, {
      encoding: 'utf-8',
    })
    if (output.trim()) {
      return output
        .trim()
        .split('\n')
        .map((pid) => parseInt(pid, 10))
        .filter((pid) => !Number.isNaN(pid))
    }
  } catch {
    // lsof failed, try netstat (fallback)
    try {
      const output = execSync(
        `netstat -tulpn 2>/dev/null | grep :${port} | awk '{print $7}' | cut -d'/' -f1`,
        { encoding: 'utf-8' },
      )
      if (output.trim()) {
        return output
          .trim()
          .split('\n')
          .map((pid) => parseInt(pid, 10))
          .filter((pid) => !Number.isNaN(pid))
      }
    } catch {
      // Both failed, return empty
    }
  }
  return []
}

/**
 * Kill a process by PID
 */
function killProcess(pid: number, force = false): boolean {
  try {
    const signal = force ? '-9' : '-15'
    execSync(`kill ${signal} ${pid} 2>/dev/null`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Get process name from PID
 */
function getProcessName(pid: number): string {
  try {
    const output = execSync(`ps -p ${pid} -o comm= 2>/dev/null`, {
      encoding: 'utf-8',
    })
    return output.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Main function
 */
function main() {
  console.log('🔍 Scanning for processes using Jeju network ports...\n')

  const ports = getAllPorts()
  const killedProcesses: Array<{ port: number; pid: number; name: string }> = []
  const activePorts: Array<{ port: number; pids: number[] }> = []

  // Check each port
  for (const portInfo of ports) {
    const pids = getPidsOnPort(portInfo.port)
    if (pids.length > 0) {
      activePorts.push({ port: portInfo.port, pids })
    }
  }

  if (activePorts.length === 0) {
    console.log('✅ No processes found using Jeju network ports')
    return
  }

  console.log(`Found ${activePorts.length} port(s) in use:\n`)

  // Show what we found
  for (const { port, pids } of activePorts) {
    const portInfo = ports.find((p) => p.port === port)
    const serviceName = portInfo?.name || 'unknown'
    console.log(`  Port ${port} (${serviceName}):`)
    for (const pid of pids) {
      const procName = getProcessName(pid)
      console.log(`    - PID ${pid} (${procName})`)
    }
    console.log()
  }

  // Ask for confirmation (unless --force flag)
  const forceFlag = process.argv.includes('--force') || process.argv.includes('-f')
  if (!forceFlag) {
    console.log('⚠️  This will kill all processes listed above.')
    console.log('   Use --force flag to skip confirmation\n')
    return
  }

  // Kill processes
  console.log('🔪 Killing processes...\n')

  for (const { port, pids } of activePorts) {
    for (const pid of pids) {
      const procName = getProcessName(pid)
      console.log(`Killing PID ${pid} (${procName}) on port ${port}...`)

      // Try graceful kill first
      if (killProcess(pid, false)) {
        // Wait a bit and check if still alive
        Bun.sleep(100)
        const stillAlive = getPidsOnPort(port).includes(pid)
        if (stillAlive) {
          console.log(`  Process still alive, force killing...`)
          killProcess(pid, true)
        }
        killedProcesses.push({ port, pid, name: procName })
      } else {
        console.log(`  Failed to kill PID ${pid}`)
      }
    }
  }

  console.log(`\n✅ Killed ${killedProcesses.length} process(es)`)

  // Verify ports are free
  console.log('\n🔍 Verifying ports are free...')
  const stillInUse: number[] = []
  for (const { port } of activePorts) {
    const remainingPids = getPidsOnPort(port)
    if (remainingPids.length > 0) {
      stillInUse.push(port)
      console.log(`  ⚠️  Port ${port} still in use by: ${remainingPids.join(', ')}`)
    }
  }

  if (stillInUse.length === 0) {
    console.log('✅ All ports are now free')
  } else {
    console.log(`\n⚠️  ${stillInUse.length} port(s) still in use`)
    console.log('   You may need to kill these processes manually')
  }
}

// Run if executed directly
if (import.meta.main) {
  main()
}
