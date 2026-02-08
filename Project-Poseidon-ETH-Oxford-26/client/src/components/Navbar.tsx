import { Link, useLocation } from "wouter";
import { Anchor, Wallet, BarChart2, FileText, ChevronDown, LogOut, Copy, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { useVaultDeposit, useNativeBalance, useFlrUsdPrice } from '@/hooks/useContract';
import { useMarketData } from '@/lib/MarketDataContext';

const navLinks = [
  { label: "Markets", href: "/", icon: BarChart2 },
  { label: "Portfolio", href: "/portfolio", icon: Wallet },
  { label: "Requests", href: "/requests", icon: FileText },
];

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { deposit, isLoading: depositLoading } = useVaultDeposit();
  const { balance, symbol } = useNativeBalance();
  const { priceUsd } = useFlrUsdPrice();
  const { setDepositModalOpen } = useMarketData();
  
  // Calculate USD value of vault deposit
  const depositUsd = parseFloat(deposit) * priceUsd;
  const balanceUsd = parseFloat(balance) * priceUsd;

  if (!isConnected) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <Button 
            size="sm" 
            variant="default" 
            className="gap-1.5 bg-primary hover:bg-primary/90" 
            onClick={openConnectModal}
            data-testid="button-connect"
          >
            <Wallet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Connect Wallet</span>
          </Button>
        )}
      </ConnectButton.Custom>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Vault Balance Display - Clickable to open deposit modal */}
      <button 
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary/50 border border-border text-xs text-muted-foreground hover:bg-secondary/70 transition-colors cursor-pointer" 
        data-testid="text-balance"
        title={`Vault Deposit: ${parseFloat(deposit).toFixed(4)} ${symbol} - Click to deposit/withdraw`}
        onClick={() => setDepositModalOpen(true)}
      >
        <Wallet className="w-3.5 h-3.5" />
        <span className="font-mono">
          {depositLoading ? '...' : `$${depositUsd.toFixed(2)}`}
        </span>
        <Plus className="w-3 h-3 text-primary" />
      </button>

      {/* Wallet Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            size="sm" 
            variant="outline" 
            className="gap-1.5 font-mono text-xs"
            data-testid="button-wallet"
          >
            <div className="w-2 h-2 rounded-full bg-green-500" />
            {formatAddress(address!)}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-3 py-2">
            <div className="text-xs text-muted-foreground mb-1">Connected Wallet</div>
            <div className="font-mono text-sm">{formatAddress(address!)}</div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-2 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Wallet Balance</span>
              <span className="font-mono">{parseFloat(balance).toFixed(4)} {symbol}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">≈ USD</span>
              <span className="font-mono">${balanceUsd.toFixed(2)}</span>
            </div>
            <DropdownMenuSeparator />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Vault Deposit</span>
              <span className="font-mono">{parseFloat(deposit).toFixed(4)} {symbol}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">≈ USD</span>
              <span className="font-mono text-primary">${depositUsd.toFixed(2)}</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="cursor-pointer gap-2"
            onClick={() => setDepositModalOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Deposit / Withdraw
          </DropdownMenuItem>
          <DropdownMenuItem 
            className="cursor-pointer gap-2"
            onClick={() => navigator.clipboard.writeText(address!)}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Address
          </DropdownMenuItem>
          <DropdownMenuItem 
            className="cursor-pointer gap-2"
            onClick={() => window.open(`https://coston2-explorer.flare.network/address/${address}`, '_blank')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on Explorer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            onClick={() => disconnect()}
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function Navbar() {
  const [location] = useLocation();

  function isLinkActive(link: typeof navLinks[0]) {
    if (link.href === "/") return location === "/";
    if (link.label === "Portfolio") return location === "/portfolio";
    if (link.label === "Requests") return location === "/requests";
    return false;
  }

  return (
    <header className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur-sm" data-testid="navbar">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer shrink-0" data-testid="link-home">
                <Anchor className="w-5 h-5 text-primary" />
                <span className="text-base font-semibold tracking-tight">Poseidon</span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1" data-testid="nav-links">
              {navLinks.map((link) => (
                <Link key={link.label} href={link.href}>
                  <button
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm transition-colors",
                      isLinkActive(link)
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    data-testid={`nav-${link.label.toLowerCase()}`}
                  >
                    {link.label}
                  </button>
                </Link>
              ))}
            </nav>
          </div>

          <WalletButton />
        </div>
      </div>
    </header>
  );
}
