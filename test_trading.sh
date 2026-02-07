#!/bin/bash
# Test trading on MaritimeShield Rust CLOB

API="http://localhost:8080"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          MaritimeShield CLOB Trading Test                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

# Get first market
MARKET_ID=$(curl -s "$API/api/markets" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
VESSEL=$(curl -s "$API/api/markets" | grep -o '"vessel_name":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "📦 Market: $VESSEL"
echo "   ID: $MARKET_ID"
echo

# Deposit funds
echo "💰 Depositing funds..."
curl -s -X POST "$API/api/users/alice/deposit" -H "Content-Type: application/json" -d '{"amount": 10000}' > /dev/null
curl -s -X POST "$API/api/users/bob/deposit" -H "Content-Type: application/json" -d '{"amount": 10000}' > /dev/null
curl -s -X POST "$API/api/users/charlie/deposit" -H "Content-Type: application/json" -d '{"amount": 10000}' > /dev/null
echo "   Alice, Bob, Charlie each have \$10,000"
echo

# Place YES bids (people who want to hedge/insure)
echo "📈 Placing YES orders (hedgers buying insurance)..."
curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"alice\",\"side\":\"YES\",\"order_type\":\"LIMIT\",\"price\":38,\"quantity\":500}" > /dev/null
echo "   Alice: BUY YES @ 38¢ × 500 shares"

curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"alice\",\"side\":\"YES\",\"order_type\":\"LIMIT\",\"price\":35,\"quantity\":300}" > /dev/null
echo "   Alice: BUY YES @ 35¢ × 300 shares"

curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"bob\",\"side\":\"YES\",\"order_type\":\"LIMIT\",\"price\":32,\"quantity\":400}" > /dev/null
echo "   Bob: BUY YES @ 32¢ × 400 shares"
echo

# Place NO bids (speculators/shipowners betting no demurrage)
echo "📉 Placing NO orders (speculators selling insurance)..."
curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"charlie\",\"side\":\"NO\",\"order_type\":\"LIMIT\",\"price\":58,\"quantity\":400}" > /dev/null
echo "   Charlie: BUY NO @ 58¢ (= sell YES @ 42¢) × 400 shares"

curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"charlie\",\"side\":\"NO\",\"order_type\":\"LIMIT\",\"price\":55,\"quantity\":300}" > /dev/null
echo "   Charlie: BUY NO @ 55¢ (= sell YES @ 45¢) × 300 shares"

curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"bob\",\"side\":\"NO\",\"order_type\":\"LIMIT\",\"price\":52,\"quantity\":250}" > /dev/null
echo "   Bob: BUY NO @ 52¢ (= sell YES @ 48¢) × 250 shares"
echo

# Get orderbook
echo "📊 Current Orderbook:"
echo "───────────────────────────────────────────────"
curl -s "$API/api/markets/$MARKET_ID" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    ob = data.get('data', data).get('orderbook', {})
    
    asks = ob.get('yes_asks', [])
    bids = ob.get('yes_bids', [])
    
    print('  ASKS (sell YES):')
    if asks:
        for a in asks[:5]:
            print(f'    {a[\"price\"]:3}¢  │  {a[\"quantity\"]:5} shares')
    else:
        print('    (empty)')
    
    print('  ─────────────────────────')
    print('  BIDS (buy YES):')
    if bids:
        for b in bids[:5]:
            print(f'    {b[\"price\"]:3}¢  │  {b[\"quantity\"]:5} shares')
    else:
        print('    (empty)')
    
    spread = ob.get('spread')
    last = ob.get('last_price')
    print(f'  ─────────────────────────')
    print(f'  Spread: {spread if spread else \"--\"}¢ │ Last: {last if last else \"--\"}¢')
except Exception as e:
    print(f'Error: {e}')
"
echo

# Execute a trade
echo "🔄 Executing a trade..."
echo "   Alice buys YES @ 45¢ × 200 (matches Charlie's NO @ 55¢)"
RESULT=$(curl -s -X POST "$API/api/orders" -H "Content-Type: application/json" \
  -d "{\"market_id\":\"$MARKET_ID\",\"user_id\":\"alice\",\"side\":\"YES\",\"order_type\":\"LIMIT\",\"price\":45,\"quantity\":200}")

if echo "$RESULT" | grep -q '"trades":\[{'; then
    echo "   ✅ TRADE EXECUTED!"
    PRICE=$(echo "$RESULT" | grep -o '"price":[0-9]*' | head -1 | cut -d: -f2)
    QTY=$(echo "$RESULT" | grep -o '"quantity":[0-9]*' | head -1 | cut -d: -f2)
    echo "   Price: ${PRICE}¢ | Quantity: $QTY shares"
else
    echo "   ⏳ Order added to book (no match)"
fi
echo

# Check positions
echo "👥 Positions:"
echo "   Alice: $(curl -s "$API/api/users/alice/positions" | grep -o '"yes_shares":[0-9]*' | cut -d: -f2) YES shares"
echo "   Charlie: $(curl -s "$API/api/users/charlie/positions" | grep -o '"no_shares":[0-9]*' | cut -d: -f2) NO shares"
echo

# Final balances
echo "💵 Balances:"
ALICE_BAL=$(curl -s "$API/api/users/alice/balance" | grep -o '"balance":[0-9.]*' | cut -d: -f2)
BOB_BAL=$(curl -s "$API/api/users/bob/balance" | grep -o '"balance":[0-9.]*' | cut -d: -f2)
CHARLIE_BAL=$(curl -s "$API/api/users/charlie/balance" | grep -o '"balance":[0-9.]*' | cut -d: -f2)
echo "   Alice: \$${ALICE_BAL:-0}"
echo "   Bob: \$${BOB_BAL:-0}"
echo "   Charlie: \$${CHARLIE_BAL:-0}"
echo

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Test complete! Open http://localhost:8080/index-rust.html   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
