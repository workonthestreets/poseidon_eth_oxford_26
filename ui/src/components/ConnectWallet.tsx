import { useAccount, useDisconnect, useBalance } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { formatAddress, formatBalance } from '../utils/format'
import { useState, useEffect } from 'react'

export default function ConnectWallet() {
  const { address, isConnected, chain } = useAccount()
  const { disconnect } = useDisconnect()
  const { open } = useAppKit()
  const { data: balance } = useBalance({
    address,
  })

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isDropdownOpen) return

    const handleClickOutside = () => setIsDropdownOpen(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isDropdownOpen])

  if (!mounted) {
    return (
      <button className="wallet-btn loading">
        <div className="loading-placeholder"></div>
      </button>
    )
  }

  if (!isConnected) {
    return (
      <button
        onClick={() => open()}
        className="wallet-btn connect"
      >
        Connect Wallet
      </button>
    )
  }

  return (
    <div className="wallet-connected-wrapper">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsDropdownOpen(!isDropdownOpen)
        }}
        className="wallet-btn connected"
      >
        <div className="wallet-info">
          <div className="status-dot"></div>
          <span className="address">{formatAddress(address!)}</span>
          {balance && (
            <span className="balance">
              {formatBalance(balance.formatted)} {balance.symbol}
            </span>
          )}
        </div>
        <svg 
          className={`chevron ${isDropdownOpen ? 'open' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isDropdownOpen && (
        <div className="wallet-dropdown">
          {/* Account Info */}
          <div className="dropdown-section account-info">
            <div className="section-header">
              <span className="label">Connected</span>
              <div className="status">
                <div className="status-dot"></div>
                <span>Active</span>
              </div>
            </div>
            <div className="address-row">
              <div className="address">{formatAddress(address!)}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (address) {
                    navigator.clipboard.writeText(address)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }
                }}
                className="copy-btn"
                title="Copy address"
              >
                {copied ? (
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
            {balance && (
              <div className="balance-display">
                {formatBalance(balance.formatted)} {balance.symbol}
              </div>
            )}
          </div>

          {/* Chain Info */}
          {chain && (
            <div className="dropdown-section chain-info">
              <span className="label">Network</span>
              <span className="chain-name">{chain.name}</span>
            </div>
          )}

          {/* Actions */}
          <div className="dropdown-actions">
            <button
              onClick={() => {
                open({ view: 'Account' })
                setIsDropdownOpen(false)
              }}
              className="action-btn"
            >
              <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Account Settings
            </button>
            <button
              onClick={() => {
                open({ view: 'Networks' })
                setIsDropdownOpen(false)
              }}
              className="action-btn"
            >
              <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
              </svg>
              Switch Network
            </button>
            <button
              onClick={() => {
                disconnect()
                setIsDropdownOpen(false)
              }}
              className="action-btn disconnect"
            >
              <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
