import { useState } from "react";
import { useAccount } from "wagmi";
import { Wallet, ArrowDownUp, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeposit, useWithdraw, useVaultDeposit, useNativeBalance, useFlrUsdPrice } from "@/hooks/useContract";
import { cn } from "@/lib/utils";

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const { isConnected, address, chainId } = useAccount();
  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  
  // Debug connection
  console.log('DepositModal - isConnected:', isConnected, 'address:', address, 'chainId:', chainId);
  
  const { deposit: vaultDeposit, refetch: refetchDeposit } = useVaultDeposit();
  const { balance: walletBalance, symbol, refetch: refetchBalance } = useNativeBalance();
  const { priceUsd } = useFlrUsdPrice();
  
  const { 
    deposit, 
    isPending: isDepositPending, 
    isConfirming: isDepositConfirming, 
    isSuccess: isDepositSuccess,
    error: depositError,
    reset: resetDeposit,
    hash: depositHash,
  } = useDeposit();
  
  const { 
    withdraw, 
    isPending: isWithdrawPending, 
    isConfirming: isWithdrawConfirming, 
    isSuccess: isWithdrawSuccess,
    error: withdrawError,
    reset: resetWithdraw,
    hash: withdrawHash,
  } = useWithdraw();
  
  // Log state changes for debugging
  console.log('Deposit state:', { isDepositPending, isDepositConfirming, isDepositSuccess, depositError, depositHash });
  console.log('Withdraw state:', { isWithdrawPending, isWithdrawConfirming, isWithdrawSuccess, withdrawError, withdrawHash });

  const isLoading = isDepositPending || isDepositConfirming || isWithdrawPending || isWithdrawConfirming;
  const isSuccess = isDepositSuccess || isWithdrawSuccess;
  const error = depositError || withdrawError;

  const amountNum = parseFloat(amount) || 0;
  const amountUsd = amountNum * priceUsd;
  
  const maxDeposit = parseFloat(walletBalance);
  const maxWithdraw = parseFloat(vaultDeposit);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted, amount:', amount, 'amountNum:', amountNum, 'isConnected:', isConnected);
    
    if (!isConnected) {
      console.error('Wallet not connected!');
      return;
    }
    
    if (amountNum <= 0) {
      console.log('Amount is zero or negative');
      return;
    }
    
    // Reset previous state
    if (activeTab === "deposit") {
      resetDeposit?.();
      console.log('Calling deposit with amount:', amount);
      deposit(amount);
    } else {
      resetWithdraw?.();
      console.log('Calling withdraw with amount:', amount);
      withdraw(amount);
    }
  };
  
  // Refetch balances after success
  if (isDepositSuccess || isWithdrawSuccess) {
    setTimeout(() => {
      refetchDeposit();
      refetchBalance();
    }, 2000);
  }

  const handleMax = () => {
    const max = activeTab === "deposit" ? maxDeposit : maxWithdraw;
    setAmount(max.toFixed(6));
  };

  const resetForm = () => {
    setAmount("");
  };

  if (!isConnected) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Vault Management
          </DialogTitle>
          <DialogDescription>
            Deposit FLR to trade on markets or withdraw your available balance.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "deposit" | "withdraw"); setAmount(""); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="mt-4">
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-secondary/30 border border-border">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Wallet Balance</span>
                  <span className="font-mono">{parseFloat(walletBalance).toFixed(4)} {symbol}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Vault Balance</span>
                  <span className="font-mono text-primary">{parseFloat(vaultDeposit).toFixed(4)} {symbol}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-1 block">Amount to Deposit</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="font-mono text-lg h-12 pr-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      step="0.0001"
                      min="0"
                      max={maxDeposit}
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
                      onClick={handleMax}
                      disabled={isLoading}
                    >
                      MAX
                    </Button>
                  </div>
                  {amountNum > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      ≈ ${amountUsd.toFixed(2)} USD
                    </div>
                  )}
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{error.message || 'Transaction failed'}</span>
                  </div>
                )}

                {isSuccess && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-trade-green/10 border border-trade-green/30 text-sm text-trade-green">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Deposit successful!</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12"
                  disabled={isLoading || amountNum <= 0 || amountNum > maxDeposit}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isDepositConfirming ? 'Confirming...' : 'Depositing...'}
                    </>
                  ) : (
                    <>
                      <ArrowDownUp className="w-4 h-4 mr-2" />
                      Deposit {symbol}
                    </>
                  )}
                </Button>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="withdraw" className="mt-4">
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-secondary/30 border border-border">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Available to Withdraw</span>
                  <span className="font-mono text-primary">{parseFloat(vaultDeposit).toFixed(4)} {symbol}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-1 block">Amount to Withdraw</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="font-mono text-lg h-12 pr-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      step="0.0001"
                      min="0"
                      max={maxWithdraw}
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
                      onClick={handleMax}
                      disabled={isLoading}
                    >
                      MAX
                    </Button>
                  </div>
                  {amountNum > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      ≈ ${amountUsd.toFixed(2)} USD
                    </div>
                  )}
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{error.message || 'Transaction failed'}</span>
                  </div>
                )}

                {isSuccess && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-trade-green/10 border border-trade-green/30 text-sm text-trade-green">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Withdrawal successful!</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12"
                  variant="outline"
                  disabled={isLoading || amountNum <= 0 || amountNum > maxWithdraw}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isWithdrawConfirming ? 'Confirming...' : 'Withdrawing...'}
                    </>
                  ) : (
                    <>
                      <ArrowDownUp className="w-4 h-4 mr-2" />
                      Withdraw {symbol}
                    </>
                  )}
                </Button>
              </form>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
