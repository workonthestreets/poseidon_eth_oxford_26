import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from 'viem'

// Your Reown (WalletConnect) Project ID
export const projectId = 'cb43430d4b16c2872f38833a2280e823'

// Define Coston2 chain
export const coston2 = defineChain({
  id: 114,
  name: 'Coston2',
  nativeCurrency: {
    decimals: 18,
    name: 'Coston2 Flare',
    symbol: 'C2FLR',
  },
  rpcUrls: {
    default: {
      http: ['https://coston2-api.flare.network/ext/bc/C/rpc'],
    },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://coston2-explorer.flare.network' },
  },
  testnet: true,
})

// Supported networks
export const networks = [coston2]

// Metadata for the app
const metadata = {
  name: 'Maritime Shield',
  description: 'Maritime Risk Prediction Market',
  url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
}

// Create Wagmi Adapter
export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false,
})

// Create AppKit modal
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#00d4ff',
    '--w3m-border-radius-master': '8px',
  },
})

export const config = wagmiAdapter.wagmiConfig
