import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useAccount, useBalance } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { MaritimeRFQVaultABI } from '@/lib/contractABI';
import { CONTRACT_ADDRESSES, coston2 } from '@/lib/web3Config';

// Get contract address for current chain (defaults to Coston2)
function getContractAddress(chainId?: number): `0x${string}` {
  const chain = chainId || coston2.id;
  return CONTRACT_ADDRESSES[chain as keyof typeof CONTRACT_ADDRESSES]?.MaritimeRFQVault || 
         CONTRACT_ADDRESSES[coston2.id].MaritimeRFQVault;
}

// Hook to get user's vault deposit balance
export function useVaultDeposit() {
  const { address, chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress,
    abi: MaritimeRFQVaultABI,
    functionName: 'deposits',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && contractAddress !== '0x0000000000000000000000000000000000000000',
    },
  });

  return {
    deposit: data ? formatEther(data as bigint) : '0',
    depositRaw: data as bigint | undefined,
    isLoading,
    error,
    refetch,
  };
}

// Hook to get native balance
export function useNativeBalance() {
  const { address } = useAccount();
  const { data, isLoading, error, refetch } = useBalance({
    address,
  });

  return {
    balance: data ? formatEther(data.value) : '0',
    balanceRaw: data?.value,
    symbol: data?.symbol || 'FLR',
    isLoading,
    error,
    refetch,
  };
}

// Hook to get user's position in a market
export function usePosition(marketId: number) {
  const { address, chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress,
    abi: MaritimeRFQVaultABI,
    functionName: 'getPosition',
    args: address ? [BigInt(marketId), address] : undefined,
    query: {
      enabled: !!address && contractAddress !== '0x0000000000000000000000000000000000000000',
    },
  });

  const position = data as [bigint, bigint, boolean] | undefined;
  
  return {
    yesShares: position ? Number(position[0]) : 0,
    noShares: position ? Number(position[1]) : 0,
    claimed: position ? position[2] : false,
    isLoading,
    error,
    refetch,
  };
}

// Hook to get market data
export function useMarket(marketId: number) {
  const { chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress,
    abi: MaritimeRFQVaultABI,
    functionName: 'markets',
    args: [BigInt(marketId)],
    query: {
      enabled: contractAddress !== '0x0000000000000000000000000000000000000000',
    },
  });

  const market = data as [
    `0x${string}`, // uuid
    string,        // vesselIMO
    string,        // description
    bigint,        // totalCollateral
    bigint,        // totalShares
    bigint,        // expiresAt
    boolean,       // settled
    boolean        // outcome
  ] | undefined;

  return {
    uuid: market?.[0],
    vesselIMO: market?.[1],
    description: market?.[2],
    totalCollateral: market ? formatEther(market[3]) : '0',
    totalShares: market ? Number(market[4]) : 0,
    expiresAt: market ? new Date(Number(market[5]) * 1000) : null,
    settled: market?.[6] ?? false,
    outcome: market?.[7] ?? false,
    isLoading,
    error,
    refetch,
  };
}

// Hook to get market count
export function useMarketCount() {
  const { chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress,
    abi: MaritimeRFQVaultABI,
    functionName: 'marketCount',
    query: {
      enabled: contractAddress !== '0x0000000000000000000000000000000000000000',
    },
  });

  return {
    count: data ? Number(data) : 0,
    isLoading,
    error,
    refetch,
  };
}

// Hook to get FLR/USD price
export function useFlrUsdPrice() {
  const { chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress,
    abi: MaritimeRFQVaultABI,
    functionName: 'flrPriceUSD',
    query: {
      enabled: contractAddress !== '0x0000000000000000000000000000000000000000',
    },
  });

  // Price from FTSO has variable decimals, typically 5 decimals
  // e.g., 2000 with 5 decimals = $0.02
  const priceRaw = data as bigint | undefined;
  // Default to $0.02 if not set (before updatePrice called)
  const priceUsd = priceRaw && priceRaw > 0n ? Number(priceRaw) / 1e5 : 0.02;

  return {
    priceUsd,
    priceRaw,
    isLoading,
    error,
    refetch,
  };
}

// Hook to deposit FLR to vault
export function useDeposit() {
  const { chainId, address } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data: hash, writeContract, isPending, error, reset } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const deposit = (amountEther: string) => {
    if (!address) {
      console.error('No wallet connected');
      return;
    }
    if (!amountEther || parseFloat(amountEther) <= 0) {
      console.error('Invalid amount');
      return;
    }
    
    console.log('Depositing', amountEther, 'to', contractAddress);
    
    writeContract({
      address: contractAddress,
      abi: MaritimeRFQVaultABI,
      functionName: 'deposit',
      value: parseEther(amountEther),
    });
  };

  return {
    deposit,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// Hook to withdraw FLR from vault
export function useWithdraw() {
  const { chainId, address } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data: hash, writeContract, isPending, error, reset } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const withdraw = (amountEther: string) => {
    if (!address) {
      console.error('No wallet connected');
      return;
    }
    
    console.log('Withdrawing', amountEther, 'from', contractAddress);
    
    writeContract({
      address: contractAddress,
      abi: MaritimeRFQVaultABI,
      functionName: 'withdraw',
      args: [parseEther(amountEther)],
    });
  };

  return {
    withdraw,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// Hook to claim winnings
export function useClaim() {
  const { chainId } = useAccount();
  const contractAddress = getContractAddress(chainId);
  
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const claim = async (marketId: number) => {
    writeContract({
      address: contractAddress,
      abi: MaritimeRFQVaultABI,
      functionName: 'claim',
      args: [BigInt(marketId)],
    });
  };

  return {
    claim,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
