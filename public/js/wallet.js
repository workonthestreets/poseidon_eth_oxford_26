/**
 * Wallet Connection Module for Maritime Shield
 * Ultra-minimal version - bypasses ethers.BrowserProvider to avoid proxy conflicts
 */

// ============================================
// CONFIGURATION
// ============================================
const COSTON2_CHAIN = {
  chainId: 114,
  chainIdHex: "0x72",
  name: "Coston2",
  currency: "C2FLR",
  explorerUrl: "https://coston2-explorer.flare.network",
  rpcUrl: "https://coston2-api.flare.network/ext/bc/C/rpc",
};

const CONTRACTS = {
  oracle: "YOUR_ORACLE_ADDRESS",
  market: "YOUR_MARKET_ADDRESS",
};

// State
let userAddress = null;
let jsonRpcProvider = null; // For read-only operations
let connectedProvider = null; // Reference to window.ethereum.request

// Contract ABIs
const MARKET_ABI = [
  "function buyYesShares(uint256 marketId) payable",
  "function buyNoShares(uint256 marketId) payable",
  "function claimWinnings(uint256 marketId)",
  "function getMarketOdds(uint256 marketId) view returns (uint256 yesPercent, uint256 noPercent)",
  "function getPosition(uint256 marketId, address user) view returns (tuple(uint256 yesShares, uint256 noShares, bool claimed))",
];

// ============================================
// TOAST NOTIFICATIONS (Polymarket-style, bottom-right)
// ============================================
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100000;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  
  const styles = {
    success: { border: '#10b981', icon: '✓' },
    error: { border: '#ef4444', icon: '✕' },
    warning: { border: '#f59e0b', icon: '!' },
    info: { border: '#6366f1', icon: 'ℹ' }
  };
  
  const style = styles[type] || styles.info;
  
  toast.style.cssText = `
    padding: 14px 20px;
    background: #1a1a2e;
    border: 1px solid ${style.border};
    border-left: 4px solid ${style.border};
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #e5e7eb;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    animation: toastSlideIn 0.3s ease;
    max-width: 380px;
    display: flex;
    align-items: center;
    gap: 12px;
  `;
  
  toast.innerHTML = `
    <span style="
      width: 22px; height: 22px;
      border-radius: 50%;
      background: rgba(${style.border === '#10b981' ? '16,185,129' : style.border === '#ef4444' ? '239,68,68' : style.border === '#f59e0b' ? '245,158,11' : '99,102,241'}, 0.15);
      border: 1px solid ${style.border};
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: ${style.border};
    ">${style.icon}</span>
    <span>${message}</span>
  `;
  
  if (!document.getElementById('toast-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'toast-styles';
    styleEl.textContent = `
      @keyframes toastSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes toastSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
    `;
    document.head.appendChild(styleEl);
  }
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// RAW ETHEREUM REQUEST (bypasses all proxies)
// ============================================
async function rawRequest(method, params = []) {
  return new Promise((resolve, reject) => {
    const ethereum = window.ethereum;
    if (!ethereum) {
      reject(new Error("No wallet found"));
      return;
    }
    
    // Use the most basic request method
    ethereum.request({ method, params })
      .then(resolve)
      .catch(reject);
  });
}

// ============================================
// WALLET CONNECTION
// ============================================
async function initWeb3Modal() {
  console.log("Initializing wallet module...");
  
  // Check if any ethereum provider exists
  if (typeof window.ethereum === "undefined") {
    console.log("No wallet detected");
    updateWalletUI(null, "No Wallet");
    return;
  }
  
  console.log("Wallet provider detected");
  
  // Create JSON-RPC provider for read operations (no wallet needed)
  try {
    jsonRpcProvider = new ethers.JsonRpcProvider(COSTON2_CHAIN.rpcUrl);
    console.log("JSON-RPC provider created");
  } catch (e) {
    console.error("Failed to create JSON-RPC provider:", e);
  }
  
  // Check if already connected
  try {
    const accounts = await rawRequest('eth_accounts');
    if (accounts && accounts.length > 0) {
      userAddress = accounts[0];
      updateWalletUI(userAddress, "Connected");
      showToast("Wallet reconnected!", "success");
      setupEventListeners();
    } else {
      updateWalletUI(null, "Ready");
    }
  } catch (error) {
    console.error("Init error:", error);
    updateWalletUI(null, "Ready");
  }
}

function setupEventListeners() {
  try {
    // These might fail due to proxy issues, so wrap in try-catch
    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          userAddress = accounts[0];
          updateWalletUI(userAddress, "Connected");
          showToast(`Account: ${userAddress.slice(0,6)}...${userAddress.slice(-4)}`, "info");
        }
      });
      
      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }
  } catch (e) {
    console.warn("Could not setup event listeners:", e);
  }
}

async function connectWallet() {
  console.log("Connect wallet clicked");
  
  if (typeof window.ethereum === "undefined") {
    showToast("Please install MetaMask!", "error", 5000);
    window.open("https://metamask.io/download/", "_blank");
    return null;
  }

  try {
    showToast("Connecting...", "info", 2000);
    
    // Request accounts using raw request
    const accounts = await rawRequest('eth_requestAccounts');
    
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts returned");
    }

    userAddress = accounts[0];
    console.log("Connected:", userAddress);
    
    // Switch to Coston2
    await switchToCoston2();
    
    // Setup listeners
    setupEventListeners();

    updateWalletUI(userAddress, "Connected");
    showToast(`Connected: ${userAddress.slice(0,6)}...${userAddress.slice(-4)}`, "success");

    return userAddress;
    
  } catch (error) {
    console.error("Connection error:", error);
    
    if (error.code === 4001) {
      showToast("Connection rejected by user", "warning");
    } else if (error.code === -32002) {
      showToast("Check your wallet - connection pending", "warning", 5000);
    } else {
      showToast("Connection failed: " + (error.message || "Unknown error"), "error");
    }
    
    updateWalletUI(null, "Error");
    return null;
  }
}

function disconnectWallet() {
  userAddress = null;
  updateWalletUI(null, "Disconnected");
  showToast("Wallet disconnected", "info");
}

async function switchToCoston2() {
  try {
    await rawRequest("wallet_switchEthereumChain", [{ chainId: COSTON2_CHAIN.chainIdHex }]);
  } catch (switchError) {
    if (switchError.code === 4902) {
      await rawRequest("wallet_addEthereumChain", [{
        chainId: COSTON2_CHAIN.chainIdHex,
        chainName: COSTON2_CHAIN.name,
        nativeCurrency: {
          name: "Coston2 Flare",
          symbol: COSTON2_CHAIN.currency,
          decimals: 18,
        },
        rpcUrls: [COSTON2_CHAIN.rpcUrl],
        blockExplorerUrls: [COSTON2_CHAIN.explorerUrl],
      }]);
      showToast("Coston2 network added!", "success", 2000);
    } else {
      console.error("Switch network error:", switchError);
    }
  }
}

function updateWalletUI(address, status) {
  const walletBtn = document.getElementById("wallet-btn");
  const walletAddress = document.getElementById("wallet-address");
  const walletStatus = document.getElementById("wallet-status");

  if (walletBtn) {
    walletBtn.textContent = address ? "Disconnect" : "Connect Wallet";
    walletBtn.onclick = address ? disconnectWallet : connectWallet;
  }

  if (walletAddress) {
    walletAddress.textContent = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  }

  if (walletStatus) {
    walletStatus.textContent = status;
    walletStatus.className = address ? "status-connected" : "status-disconnected";
  }

  window.dispatchEvent(new CustomEvent("walletChanged", {
    detail: { address, connected: !!address }
  }));
}

// ============================================
// BALANCE & CONTRACT INTERACTIONS
// ============================================
async function getBalance() {
  if (!userAddress) return "0";
  
  try {
    // Use raw request to get balance
    const balanceHex = await rawRequest('eth_getBalance', [userAddress, 'latest']);
    const balanceWei = BigInt(balanceHex);
    return ethers.formatEther(balanceWei);
  } catch (e) {
    console.error("Get balance error:", e);
    return "0";
  }
}

async function sendTransaction(to, data, value = "0x0") {
  if (!userAddress) throw new Error("Not connected");
  
  const txParams = {
    from: userAddress,
    to: to,
    data: data,
    value: value,
  };
  
  // Estimate gas
  try {
    const gasEstimate = await rawRequest('eth_estimateGas', [txParams]);
    txParams.gas = gasEstimate;
  } catch (e) {
    console.warn("Gas estimation failed, using default");
    txParams.gas = "0x100000"; // 1M gas as fallback
  }
  
  // Send transaction
  const txHash = await rawRequest('eth_sendTransaction', [txParams]);
  showToast("Transaction sent!", "info", 3000);
  
  // Wait for confirmation
  return await waitForTransaction(txHash);
}

async function waitForTransaction(txHash, timeout = 60000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const receipt = await rawRequest('eth_getTransactionReceipt', [txHash]);
      if (receipt) {
        if (receipt.status === '0x1') {
          showToast("Transaction confirmed!", "success");
          return receipt;
        } else {
          throw new Error("Transaction failed");
        }
      }
    } catch (e) {
      // Receipt not ready yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  
  throw new Error("Transaction timeout");
}

// Encode function calls manually (simplified)
function encodeFunctionCall(functionSig, params = []) {
  const iface = new ethers.Interface([functionSig]);
  const functionName = functionSig.match(/function (\w+)/)[1];
  return iface.encodeFunctionData(functionName, params);
}

async function buyYesShares(marketId, amountEth) {
  if (CONTRACTS.market === "YOUR_MARKET_ADDRESS") {
    showToast("Demo mode - contracts not deployed", "info");
    return { demo: true };
  }
  
  showToast("Submitting transaction...", "info", 3000);
  const data = encodeFunctionCall("function buyYesShares(uint256 marketId)", [marketId]);
  const value = ethers.toQuantity(ethers.parseEther(amountEth.toString()));
  return await sendTransaction(CONTRACTS.market, data, value);
}

async function buyNoShares(marketId, amountEth) {
  if (CONTRACTS.market === "YOUR_MARKET_ADDRESS") {
    showToast("Demo mode - contracts not deployed", "info");
    return { demo: true };
  }
  
  showToast("Submitting transaction...", "info", 3000);
  const data = encodeFunctionCall("function buyNoShares(uint256 marketId)", [marketId]);
  const value = ethers.toQuantity(ethers.parseEther(amountEth.toString()));
  return await sendTransaction(CONTRACTS.market, data, value);
}

async function claimWinnings(marketId) {
  if (CONTRACTS.market === "YOUR_MARKET_ADDRESS") {
    showToast("Demo mode - contracts not deployed", "info");
    return { demo: true };
  }
  
  showToast("Claiming winnings...", "info", 3000);
  const data = encodeFunctionCall("function claimWinnings(uint256 marketId)", [marketId]);
  return await sendTransaction(CONTRACTS.market, data);
}

async function getMarketOdds(marketId) {
  // Use JSON-RPC provider for read calls (no wallet needed)
  if (!jsonRpcProvider || CONTRACTS.market === "YOUR_MARKET_ADDRESS") {
    return { yes: 50, no: 50 };
  }
  
  try {
    const contract = new ethers.Contract(CONTRACTS.market, MARKET_ABI, jsonRpcProvider);
    const [yes, no] = await contract.getMarketOdds(marketId);
    return { yes: Number(yes), no: Number(no) };
  } catch (e) {
    console.error("Get market odds error:", e);
    return { yes: 50, no: 50 };
  }
}

async function getUserPosition(marketId) {
  if (!jsonRpcProvider || !userAddress || CONTRACTS.market === "YOUR_MARKET_ADDRESS") {
    return { yesShares: 0, noShares: 0, claimed: false };
  }
  
  try {
    const contract = new ethers.Contract(CONTRACTS.market, MARKET_ABI, jsonRpcProvider);
    return await contract.getPosition(marketId, userAddress);
  } catch (e) {
    console.error("Get position error:", e);
    return { yesShares: 0, noShares: 0, claimed: false };
  }
}

// ============================================
// EXPORTS
// ============================================
window.wallet = {
  init: initWeb3Modal,
  connect: connectWallet,
  disconnect: disconnectWallet,
  getAddress: () => userAddress,
  isConnected: () => !!userAddress,
  getBalance,
  buyYesShares,
  buyNoShares,
  claimWinnings,
  getMarketOdds,
  getUserPosition,
  showToast,
  CONTRACTS,
};

document.addEventListener("DOMContentLoaded", initWeb3Modal);
