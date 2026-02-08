import { useState } from "react";
import { useCreateOrder } from "@/hooks/use-market";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function OrderForm() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("50");
  const [quantity, setQuantity] = useState("10");
  const { toast } = useToast();
  const createOrder = useCreateOrder();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const priceNum = parseInt(price);
    const qtyNum = parseInt(quantity);

    if (priceNum < 0 || priceNum > 100) {
      toast({
        title: "Invalid Price",
        description: "Price must be between 0 and 100 cents.",
        variant: "destructive",
      });
      return;
    }

    createOrder.mutate(
      {
        symbol: "DEMURRAGE-2024",
        side,
        price: priceNum,
        quantity: qtyNum,
      },
      {
        onSuccess: () => {
          toast({
            title: "Order Submitted",
            description: `${side.toUpperCase()} ${qtyNum} @ ${priceNum}¢`,
          });
        },
        onError: (err) => {
          toast({
            title: "Order Failed",
            description: err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 shadow-lg shadow-black/20">
      <h3 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
        <span className="w-2 h-6 bg-primary rounded-full"></span>
        Place Order
      </h3>

      <div className="grid grid-cols-2 gap-2 mb-6 p-1 bg-muted/30 rounded-lg border border-border/50">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={cn(
            "flex items-center justify-center gap-2 py-3 rounded-md font-bold transition-all duration-200",
            side === "buy"
              ? "bg-trade-green text-white shadow-lg shadow-trade-green/20"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
          )}
        >
          <TrendingUp className="w-4 h-4" />
          BUY
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={cn(
            "flex items-center justify-center gap-2 py-3 rounded-md font-bold transition-all duration-200",
            side === "sell"
              ? "bg-trade-red text-white shadow-lg shadow-trade-red/20"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
          )}
        >
          <TrendingDown className="w-4 h-4" />
          SELL
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="price" className="text-muted-foreground text-xs uppercase tracking-wider font-bold">Price (¢)</Label>
          <div className="relative">
            <Input
              id="price"
              type="number"
              min="1"
              max="99"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="pl-4 pr-12 h-12 bg-background font-mono text-lg border-input focus:ring-primary/20"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">¢</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity" className="text-muted-foreground text-xs uppercase tracking-wider font-bold">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-12 bg-background font-mono text-lg border-input focus:ring-primary/20"
          />
        </div>

        <div className="pt-4 border-t border-border/50">
          <div className="flex justify-between mb-4 text-sm">
            <span className="text-muted-foreground">Total Value</span>
            <span className="font-mono font-bold">${((parseInt(price) * parseInt(quantity)) / 100).toFixed(2)}</span>
          </div>

          <Button 
            type="submit" 
            disabled={createOrder.isPending}
            className={cn(
              "w-full h-12 text-lg font-bold tracking-wide shadow-lg transition-all active:scale-[0.98]",
              side === "buy" 
                ? "bg-trade-green hover:bg-trade-green/90 shadow-trade-green/20" 
                : "bg-trade-red hover:bg-trade-red/90 shadow-trade-red/20"
            )}
          >
            {createOrder.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              `${side.toUpperCase()} DEMURRAGE`
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
