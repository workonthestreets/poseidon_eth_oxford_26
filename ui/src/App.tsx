import { Web3Provider } from './components/Web3Provider'
import ConnectWallet from './components/ConnectWallet'
import './App.css'

function App() {
  return (
    <Web3Provider>
      <div className="app">
        <header>
          <div className="logo">🚢 Maritime Shield</div>
          <div className="wallet-section">
            <span className="network-badge">Coston2 Testnet</span>
            <ConnectWallet />
          </div>
        </header>

        <main>
          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">Active Markets</div>
              <div className="stat-value">2</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Your Positions</div>
              <div className="stat-value">0</div>
            </div>
          </div>

          <div className="markets-section">
            <h2 className="section-title">Prediction Markets</h2>
            
            <div className="market-card">
              <div className="market-header">
                <div>
                  <div className="market-title">MSC Oscar - PSC Detention Risk</div>
                  <div className="market-description">
                    Will vessel MSC Oscar (IMO: 9703318) be detained at Rotterdam?
                  </div>
                </div>
                <span className="market-status open">OPEN</span>
              </div>
              
              <div className="odds-bar">
                <div className="odds-yes" style={{ width: '35%' }}>YES 35%</div>
                <div className="odds-no" style={{ width: '65%' }}>NO 65%</div>
              </div>
              
              <div className="trade-section">
                <input 
                  type="number" 
                  className="amount-input" 
                  placeholder="0.1" 
                  step="0.01" 
                  min="0.01" 
                  defaultValue="0.1"
                />
                <button className="trade-btn yes">Buy YES</button>
                <button className="trade-btn no">Buy NO</button>
              </div>
            </div>

            <div className="market-card">
              <div className="market-header">
                <div>
                  <div className="market-title">Ever Given - Casualty Risk</div>
                  <div className="market-description">
                    Will vessel Ever Given (IMO: 9811000) experience a grounding incident?
                  </div>
                </div>
                <span className="market-status open">OPEN</span>
              </div>
              
              <div className="odds-bar">
                <div className="odds-yes" style={{ width: '20%' }}>YES 20%</div>
                <div className="odds-no" style={{ width: '80%' }}>NO 80%</div>
              </div>
              
              <div className="trade-section">
                <input 
                  type="number" 
                  className="amount-input" 
                  placeholder="0.1" 
                  step="0.01" 
                  min="0.01" 
                  defaultValue="0.1"
                />
                <button className="trade-btn yes">Buy YES</button>
                <button className="trade-btn no">Buy NO</button>
              </div>
            </div>
          </div>
        </main>

        <footer>
          <p>
            Built for Flare Hackathon 2025 | 
            <a href="https://coston2-explorer.flare.network" target="_blank" rel="noopener noreferrer"> Coston2 Explorer</a> | 
            <a href="https://faucet.flare.network/coston2" target="_blank" rel="noopener noreferrer"> Get Test C2FLR</a>
          </p>
        </footer>
      </div>
    </Web3Provider>
  )
}

export default App
