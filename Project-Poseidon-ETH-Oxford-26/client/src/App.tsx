import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarketDataProvider, useMarketData } from "@/lib/MarketDataContext";
import { DepositModal } from "@/components/DepositModal";
import VesselGallery from "@/pages/VesselGallery";
import VesselDetail from "@/pages/VesselDetail";
import MarketDetail from "@/pages/MarketDetail";
import Portfolio from "@/pages/Portfolio";
import Requests from "@/pages/Requests";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={VesselGallery} />
      <Route path="/vessel/:id" component={VesselDetail} />
      <Route path="/vessel/:vesselId/market/:marketId" component={MarketDetail} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/requests" component={Requests} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { depositModalOpen, setDepositModalOpen } = useMarketData();
  
  return (
    <>
      <Toaster />
      <Router />
      <DepositModal open={depositModalOpen} onOpenChange={setDepositModalOpen} />
    </>
  );
}

function App() {
  return (
    <TooltipProvider>
      <MarketDataProvider>
        <AppContent />
      </MarketDataProvider>
    </TooltipProvider>
  );
}

export default App;
