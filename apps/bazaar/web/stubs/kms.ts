// Browser stub for @jejunetwork/kms
// KMS operations are server-side only

export class KMSSigner {
  async initialize(): Promise<void> {
    throw new Error('KMS is not available in browser')
  }
  async signMessage(_message: string): Promise<{ signature: `0x${string}` }> {
    throw new Error('KMS is not available in browser')
  }
}

export function createKMSSigner(_config: {
  serviceId: string
  allowLocalDev?: boolean
}): KMSSigner {
  return new KMSSigner()
}

export function getSecureSigningService(_options?: {
  serviceId?: string
  allowLocalDev?: boolean
}): {
  generateKey(): Promise<{ privateKey: string; publicKey: string }>
  signMessage(message: string): Promise<{ signature: `0x${string}` }>
} {
  throw new Error('KMS is not available in browser')
}

export function createMPCClient(
  _config: unknown,
  _serviceAgentId?: string,
): {
  generateKey(): Promise<never>
  signMessage(_message: string): Promise<never>
} {
  throw new Error('MPC client is not available in browser')
}

export type { KMSSigner as KMSSignerType }
