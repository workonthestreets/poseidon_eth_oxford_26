import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { type Chain } from 'viem';

// Flare Coston2 Testnet
export const coston2: Chain = {
  id: 114,
  name: 'Coston2',
  nativeCurrency: {
    decimals: 18,
    name: 'Coston2 Flare',
    symbol: 'C2FLR',
  },
  rpcUrls: {
    default: { http: ['https://coston2-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Coston2 Explorer', url: 'https://coston2-explorer.flare.network' },
  },
  testnet: true,
};

// Flare Mainnet
export const flare: Chain = {
  id: 14,
  name: 'Flare',
  nativeCurrency: {
    decimals: 18,
    name: 'Flare',
    symbol: 'FLR',
  },
  rpcUrls: {
    default: { http: ['https://flare-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Flare Explorer', url: 'https://flare-explorer.flare.network' },
  },
  testnet: false,
};

// WalletConnect Project ID - get one at https://cloud.walletconnect.com
// Make sure to add localhost:3001 to the allowed origins in the dashboard
const projectId = 'cb43430d4b16c2872f38833a2280e823';

export const config = getDefaultConfig({
  appName: 'Poseidon Maritime Markets',
  projectId,
  chains: [coston2, flare],
  transports: {
    [coston2.id]: http('https://coston2-api.flare.network/ext/C/rpc'),
    [flare.id]: http('https://flare-api.flare.network/ext/C/rpc'),
  },
});

// Contract addresses - Deployed to Coston2
export const CONTRACT_ADDRESSES = {
  // Coston2 testnet - DEPLOYED
  [coston2.id]: {
    MaritimeRFQVault: '0x1B020623663d465f589c36C33F26747bBE40f411' as `0x${string}`,
  },
  // Flare mainnet - TO BE UPDATED after deployment
  [flare.id]: {
    MaritimeRFQVault: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
} as const;

export { coston2 as defaultChain };
